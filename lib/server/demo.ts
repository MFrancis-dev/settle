/**
 * The demo session: start it, simulate a payment, reset it.
 * Roadmap: S6.3, S6.4 · Spec: PRD.md FR-22..FR-24, ARCHITECTURE.md §7
 *
 * Three actions, and each one writes through the code the product writes through:
 * - `startDemoSession` seeds the fictional freelancer with `lib/db/seed-demo.ts`, which uses
 *   `createInvoice`/`createPaymentAttempt`/`recordAttemptStatus`;
 * - `simulatePayment` moves the newest live attempt one step with `recordAttemptStatus`, the same
 *   function `syncAttempt` writes with, then re-derives the invoice with `storeDerivedInvoiceStatus`;
 * - `resetDemo` deletes only rows owned by an `is_demo` account and seeds them again.
 *
 * So the demo never keeps its own copy of what a payment is. The demo transport *mirrors* the attempt
 * row (`lib/server/adapters.ts`), which is why the pay page's poll and the worker's poll read back
 * exactly what a simulation wrote and change nothing.
 *
 * Nothing here is reachable outside demo mode: every action calls `assertDemoMode` first, and
 * `lib/server/adapters.ts` refuses to let demo mode run next to a real database or a public URL.
 */

import type { AttemptStatus, InvoiceStatus, OneClickStatus } from "../core/status";
import { attemptStatusFromOneClick, canTransition, TERMINAL_ATTEMPT_STATUSES } from "../core/status";
import { demoOutcomeInput, type DemoOutcome } from "../core/schemas";
import {
  DEMO_DISPLAY_NAME,
  clearDemoData,
  findDemoUser,
  seedDemo,
} from "../db/seed-demo";
import {
  getInvoiceByPublicId,
  listInvoicesForUser,
  storeDerivedInvoiceStatus,
  type InvoiceRecord,
} from "../db/queries/invoices";
import {
  expireAttempt,
  findActiveAttemptForInvoice,
  listAttemptsForInvoice,
  recordAttemptStatus,
  type PaymentAttemptRecord,
} from "../db/queries/paymentAttempts";
import { getActiveDestination } from "../db/queries/payoutDestinations";
import { demoTxHash } from "../oneclick/demo";
import { assertDemoModeAllowed, demoSeedOptions } from "./adapters";
import { isDemoMode } from "./env-schema";
import { conflict, forbidden, notFound, rateLimited } from "./http";
import { serializeSessionCookie } from "./session";
import {
  attemptView,
  invoiceView,
  receiptUrlFor,
  type AttemptView,
  type MoneyView,
} from "./views";
import type { ServerDeps } from "./deps";

/** What a judge can make happen to an open payment — the union the request body is parsed with. */
export const DEMO_OUTCOMES: readonly DemoOutcome[] = demoOutcomeInput.options;
export type { DemoOutcome };

/** The upstream status behind each named outcome. `next` and `expired` are not upstream statuses. */
const OUTCOME_STATUS: Readonly<Record<Exclude<DemoOutcome, "next" | "expired">, OneClickStatus>> = {
  paid: "SUCCESS",
  underpaid: "INCOMPLETE_DEPOSIT",
  refunded: "REFUNDED",
  failed: "FAILED",
};

/** The happy path, one step per press: what the service reports as money arrives and settles. */
const NEXT_STATUS: Readonly<Record<AttemptStatus, OneClickStatus | null>> = {
  awaiting_deposit: "KNOWN_DEPOSIT_TX",
  payment_detected: "PROCESSING",
  processing: "SUCCESS",
  // A short deposit is a verdict the client can still answer by paying the rest.
  underpaid: "SUCCESS",
  success: null,
  refunded: null,
  failed: null,
  expired: null,
};

/** Settled invoices, so a simulation can report "this one is finished" the way the pay page does. */
const PAID_INVOICE_STATUSES: readonly InvoiceStatus[] = ["paid", "overpaid", "paid_after_cancel"];

function assertDemoMode(deps: ServerDeps): void {
  if (!isDemoMode(deps.env)) {
    throw forbidden("This server is not in demo mode, so there is nothing to simulate.");
  }
  assertDemoModeAllowed(deps.env);
}

function rateLimit(deps: ServerDeps, action: string, ip: string): void {
  const decision = deps.quoteLimits.check(`demo:${action}:${ip}`);
  if (!decision.allowed) throw rateLimited(decision.retryAfterS);
}

export interface DemoInvoiceSummary {
  invoiceId: string;
  publicId: string;
  number: string;
  clientName: string;
  status: InvoiceStatus;
  /** In the payout asset, resolved through the token list; `null` when the list could not be read. */
  total: MoneyView | null;
  payUrl: string;
  /** The receipt for the attempt that paid this invoice, when there is one. */
  receiptUrl: string | null;
  /** The payment the demo can still advance; `null` once every attempt has settled. */
  activeAttempt: AttemptView | null;
  /**
   * How many payments on this invoice have reached a terminal status.
   *
   * The demo page needs this to tell "nothing left to simulate" apart from "nothing was ever
   * started": a draft or an unpaid invoice has no active attempt either, and saying "every payment
   * has finished" about one would be a lie on the first screen a judge reads.
   */
  finishedPayments: number;
}

export interface DemoSessionView {
  demo: true;
  /** True when this call wrote the seed; false when the story was already in the database. */
  seeded: boolean;
  account: { nearAccountId: string; displayName: string; payoutAddress: string };
  invoices: DemoInvoiceSummary[];
}

async function summarise(
  deps: ServerDeps,
  invoice: InvoiceRecord,
  payoutAssetId: string | null,
): Promise<DemoInvoiceSummary> {
  const view = await invoiceView(deps, invoice, payoutAssetId);
  const attempts = await listAttemptsForInvoice(deps.db, invoice.id);
  const paidBy = attempts.find((row) => row.status === "success") ?? null;
  const active = attempts.find((row) => !TERMINAL_ATTEMPT_STATUSES.has(row.status)) ?? null;

  return {
    invoiceId: invoice.id,
    publicId: invoice.publicId,
    number: invoice.number,
    clientName: invoice.clientName,
    status: invoice.status,
    total: view.total,
    payUrl: view.payUrl,
    receiptUrl: paidBy?.receiptToken ? receiptUrlFor(deps, paidBy.receiptToken, paidBy.id) : null,
    activeAttempt: active ? await attemptView(deps, active) : null,
    finishedPayments: attempts.filter((row) => TERMINAL_ATTEMPT_STATUSES.has(row.status)).length,
  };
}

export interface DemoSignIn {
  view: DemoSessionView;
  /**
   * The demo freelancer's session cookie. Starting the demo signs the visitor in as Ada, because the
   * dashboard is half of what a judge has to see and there is no wallet here to sign with (§7). The
   * cookie is issued by the same codec a real sign-in uses, and it says `isDemo: true`, which is what
   * the banner reads and what `clearDemoData` scopes its deletes to.
   */
  cookie: string;
}

async function signInDemo(deps: ServerDeps, seeded: boolean): Promise<DemoSignIn> {
  const user = await findDemoUser(deps.db);
  if (!user) throw new Error("the demo seed did not produce the demo account");

  const destination = await getActiveDestination(deps.db, user.id);
  const invoices = await listInvoicesForUser(deps.db, user.id, { limit: 50 });
  const value = await deps.sessions.issue({
    userId: user.id,
    nearAccountId: user.nearAccountId,
    isDemo: true,
  });

  return {
    cookie: serializeSessionCookie(value, { secure: deps.secureCookies }),
    view: {
      demo: true,
      seeded,
      account: {
        nearAccountId: user.nearAccountId,
        displayName: user.displayName ?? DEMO_DISPLAY_NAME,
        payoutAddress: destination?.address ?? "",
      },
      invoices: await Promise.all(
        invoices.map((invoice) => summarise(deps, invoice, destination?.assetId ?? null)),
      ),
    },
  };
}

/**
 * `GET|POST /api/demo/session` — the demo's front door, and idempotent: it seeds the first time it is
 * called against an empty database and only reads afterwards, so reloading `/demo` never duplicates
 * the story and a judge who restarts mid-talk picks up where they left off.
 */
export async function startDemoSession(deps: ServerDeps, ip: string): Promise<DemoSignIn> {
  assertDemoMode(deps);
  rateLimit(deps, "session", ip);

  if (await findDemoUser(deps.db)) return signInDemo(deps, false);
  await seedDemo(deps.db, demoSeedOptions(deps.now));
  return signInDemo(deps, true);
}

/**
 * `POST /api/demo/reset` — wipe the demo rows and seed them again. Never touches a real account.
 *
 * The cookie is re-issued rather than kept: a reset deletes the demo user and writes a new one, so the
 * old cookie would name a row that no longer exists and every dashboard read would answer 401.
 */
export async function resetDemo(deps: ServerDeps, ip: string): Promise<DemoSignIn> {
  assertDemoMode(deps);
  rateLimit(deps, "reset", ip);

  await clearDemoData(deps.db);
  await seedDemo(deps.db, demoSeedOptions(deps.now));
  return signInDemo(deps, true);
}

/** Which outcomes an attempt can still be walked to — the demo page shows only these. */
export function availableOutcomes(status: AttemptStatus): readonly DemoOutcome[] {
  if (TERMINAL_ATTEMPT_STATUSES.has(status)) return [];
  return DEMO_OUTCOMES.filter((outcome) => {
    if (outcome === "next") return NEXT_STATUS[status] !== null;
    if (outcome === "expired") return canTransition(status, "expired");
    return canTransition(status, attemptStatusFromOneClick(OUTCOME_STATUS[outcome]));
  });
}

export interface DemoSimulationView {
  outcome: DemoOutcome;
  /** `null` for `expired`: that move is Settle's own deadline rule, not something the service reports. */
  oneclickStatus: OneClickStatus | null;
  attempt: AttemptView;
  invoiceStatus: InvoiceStatus;
  paid: boolean;
  receiptUrl: string | null;
  /** What can still happen to this attempt, so the next press is offered rather than guessed at. */
  next: readonly DemoOutcome[];
}

/**
 * `POST /api/demo/simulate-payment` — stand in for the client's wallet and the service's scan.
 *
 * One press moves the attempt one step, because a payment is a sequence a judge should be able to
 * watch (PRD FR-22), not a jump to a final state. The named outcomes exist for the paths that are
 * not on the happy one: a short deposit, a refund, a failure, an expired quote.
 *
 * An impossible move answers 409 rather than throwing out of `canTransition`, so the demo page can
 * say what is left to press instead of showing an internal error.
 */
export async function simulatePayment(
  deps: ServerDeps,
  call: { publicId: string; ip: string; outcome: DemoOutcome },
): Promise<DemoSimulationView> {
  assertDemoMode(deps);
  rateLimit(deps, "simulate", call.ip);

  const invoice = await getInvoiceByPublicId(deps.db, call.publicId);
  if (!invoice) throw notFound("No such payment link.");

  const attempt = await findActiveAttemptForInvoice(deps.db, invoice.id);
  if (!attempt) {
    throw conflict(
      "There is no open payment on this invoice to move. Get a payment address on the pay page first.",
    );
  }

  const at = new Date(deps.now());
  const stored = await applyOutcome(deps, attempt, call.outcome, at);
  const view = await attemptView(deps, stored);

  const invoiceStatus = await storeDerivedInvoiceStatus(deps.db, { invoiceId: invoice.id, at });
  if (invoiceStatus === null) throw new Error(`invoice ${invoice.id} vanished under a payment attempt`);

  return {
    outcome: call.outcome,
    oneclickStatus: call.outcome === "expired" ? null : (stored.oneclickStatus as OneClickStatus | null),
    attempt: view,
    invoiceStatus,
    paid: PAID_INVOICE_STATUSES.includes(invoiceStatus),
    receiptUrl: view.receiptUrl,
    next: availableOutcomes(stored.status),
  };
}

async function applyOutcome(
  deps: ServerDeps,
  attempt: PaymentAttemptRecord,
  outcome: DemoOutcome,
  at: Date,
): Promise<PaymentAttemptRecord> {
  if (outcome === "expired") {
    if (!canTransition(attempt.status, "expired")) {
      throw conflict(
        `This payment is ${attempt.status}, and a deadline only lapses while no deposit has arrived.`,
      );
    }
    const expired = await expireAttempt(deps.db, { attemptId: attempt.id, at });
    if (!expired) throw new Error(`demo simulation lost attempt ${attempt.id}`);
    return expired;
  }

  const oneclickStatus = outcome === "next" ? NEXT_STATUS[attempt.status] : OUTCOME_STATUS[outcome];
  if (oneclickStatus === null) {
    throw conflict(`This payment is already ${attempt.status}; nothing further can happen to it.`);
  }
  if (!canTransition(attempt.status, attemptStatusFromOneClick(oneclickStatus))) {
    throw conflict(
      `This payment is ${attempt.status}, which cannot move to ${attemptStatusFromOneClick(oneclickStatus)}.`,
    );
  }

  const stored = await recordAttemptStatus(deps.db, {
    attemptId: attempt.id,
    oneclickStatus,
    depositTxHash: attempt.depositTxHash ?? demoTxHash(`${attempt.id}:deposit`),
    deliveryTxHash:
      oneclickStatus === "SUCCESS"
        ? (attempt.deliveryTxHash ?? demoTxHash(`${attempt.id}:delivery`))
        : attempt.deliveryTxHash,
    // The demo transport reads this row back as the service's answer, so the raw body says what it
    // is: a simulation, and which one. The next poll replaces it with the mirrored status body.
    statusRaw: { demo: true, simulated: oneclickStatus },
    at,
  });
  if (!stored) throw new Error(`demo simulation lost attempt ${attempt.id}`);
  return stored;
}
