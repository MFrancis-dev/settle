/**
 * Seeds the fictional demo freelancer, payout history, and invoices in every status the app can reach.
 * Roadmap: S6.2 · Spec: PRD.md FR-22, ARCHITECTURE.md §7
 *
 * The seed writes through the same functions the app writes through — `createInvoice`,
 * `createPaymentAttempt`, `recordAttemptStatus`, `storeDerivedInvoiceStatus` — so a seeded row is a
 * row the live code could have produced, and a forward-only rule the seed broke would throw here
 * rather than look plausible on a dashboard.
 *
 * Two things this module deliberately does not do:
 * - it does not sign a quote or hash a transaction. Those live in `lib/oneclick`, a sibling layer, so
 *   the caller injects them (`quoteFor`, `hashFor`) and `lib/db` keeps pointing only at `lib/core`;
 * - it does not seed an invoice whose status is `refunded` or `failed`. `deriveInvoiceStatus` never
 *   returns either: a payment that was refunded or failed puts the invoice back to `open` so the
 *   client can retry (ARCHITECTURE.md §3.3). The refund and the failure are on the *attempt*, which
 *   is where the invoice detail page shows them.
 *
 * A seeded attempt's `statusRaw` is a placeholder. The first poll of that payment — the pay page's or
 * the worker's — replaces it with the demo service's own body, because the demo transport mirrors the
 * row it is asked about (`lib/server/adapters.ts`).
 */

import { eq, inArray } from "drizzle-orm";

import type { InvoiceStatus, OneClickStatus } from "../core/status";
import { toBaseUnits } from "../core/money";
import type { BaseUnits, QuoteSummary } from "../core/types";
import type { Database } from "./client";
import { invoiceItems, invoices, paymentAttempts, payoutDestinations, users, type User } from "./schema";
import {
  cancelInvoice,
  createInvoice,
  listInvoicesForUser,
  setInvoiceStatus,
  storeDerivedInvoiceStatus,
} from "./queries/invoices";
import { createPaymentAttempt, recordAttemptStatus } from "./queries/paymentAttempts";
import {
  getActiveDestination,
  listDestinations,
  setActiveDestination,
} from "./queries/payoutDestinations";
import { findUserByNearAccount, upsertUserByNearAccount } from "./queries/users";

/** The persona from PRD.md §3: a freelance designer in Lagos with clients in the US and EU. */
export const DEMO_ACCOUNT_ID = "ada.demo.near";
export const DEMO_DISPLAY_NAME = "Ada (demo freelancer)";
export const DEMO_EMAIL = "ada@settle.demo";

/** Asset ids from the recorded token list, so the demo never hardcodes a decimal count. */
export const DEMO_USDC_ON_NEAR =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const DEMO_USDC_ON_ETHEREUM = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
export const DEMO_USDC_ON_ARBITRUM = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
export const DEMO_WNEAR = "nep141:wrap.near";

/** Where the demo freelancer cashes out. Fictional, and checked by the same validators as a real one. */
export const DEMO_PAYOUT_ADDRESS = "ada.demo.near";
/** The previous generation, kept so the settings page has a change history to show. */
export const DEMO_PAYOUT_ADDRESS_OLD = "0x5e71e1a2f9c4d8b3a6c0f2e5d8b1a4c7f0e3d6a9";

/** A signed non-dry demo quote for one attempt. */
export type DemoQuoteFactory = (input: {
  originAsset: string;
  recipient: string;
  refundTo: string;
  amountOut: BaseUnits;
  deadline: string;
}) => QuoteSummary;

export interface SeedDemoOptions {
  quoteFor: DemoQuoteFactory;
  /** A deterministic transaction hash for a seed, so a receipt's hashes survive a reseed. */
  hashFor: (seed: string) => string;
  now?: () => number;
}

export interface SeededDemoInvoice {
  invoiceId: string;
  publicId: string;
  number: string;
  clientName: string;
  status: InvoiceStatus;
  total: BaseUnits;
}

export interface DemoSeed {
  userId: string;
  destinationId: string;
  invoices: SeededDemoInvoice[];
}

interface DemoLine {
  description: string;
  quantity: string;
  /** Dollars, converted to base units at the payout asset's 6 decimals. */
  unitPriceUsd: string;
}

interface DemoAttemptSpec {
  originAsset: string;
  /** The 1Click statuses this attempt is walked through, oldest first. */
  path: readonly OneClickStatus[];
  startedDaysAgo: number;
  /** Absent for an attempt that is still live, so the pay page has something to watch. */
  settledDaysAgo?: number;
}

interface DemoInvoiceSpec {
  clientName: string;
  clientEmail: string;
  memo?: string;
  lines: readonly DemoLine[];
  issuedDaysAgo: number;
  dueInDays: number | null;
  /** False for the one invoice Ada has not sent yet. */
  sent: boolean;
  cancelledDaysAgo?: number;
  attempts: readonly DemoAttemptSpec[];
}

/** A fictional client address per origin asset, so every refund field passes the real validators. */
const CLIENT_REFUND_ADDRESS: Readonly<Record<string, string>> = {
  [DEMO_WNEAR]: "client.berlin.near",
  [DEMO_USDC_ON_ETHEREUM]: "0x9c4a1f7e2b8d6053c1e7a9f4b2d8063c5e1a7f94",
  [DEMO_USDC_ON_ARBITRUM]: "0x9c4a1f7e2b8d6053c1e7a9f4b2d8063c5e1a7f94",
};

const usdc = (dollars: string): BaseUnits => toBaseUnits(dollars, 6);

/**
 * Ten invoices for one freelancer, between them carrying every status a dashboard can show: a draft
 * that was never sent, an invoice still owed, one whose deposit was returned, one mid-swap, one paid,
 * one short, one paid twice, one cancelled, and one paid after it was cancelled.
 */
const DEMO_INVOICES: readonly DemoInvoiceSpec[] = [
  {
    clientName: "Kestrel Health",
    clientEmail: "accounts@kestrelhealth.example",
    memo: "Not sent yet — waiting on the scope for the second audit.",
    lines: [{ description: "Design audit, 6 hours", quantity: "6", unitPriceUsd: "95" }],
    issuedDaysAgo: 2,
    dueInDays: null,
    sent: false,
    attempts: [],
  },
  {
    clientName: "Northwind Studio",
    clientEmail: "ap@northwindstudio.example",
    memo: "Sprint 12 covers the checkout redesign and the rush weekend.",
    lines: [
      { description: "Product design, sprint 12", quantity: "1", unitPriceUsd: "5000" },
      { description: "Rush surcharge", quantity: "1", unitPriceUsd: "250" },
    ],
    issuedDaysAgo: 6,
    dueInDays: 8,
    sent: true,
    attempts: [],
  },
  {
    clientName: "Ostro Games",
    clientEmail: "finance@ostrogames.example",
    memo: "The first attempt was returned: the deadline passed before the deposit arrived. The same link still works.",
    lines: [{ description: "Brand refresh, phase 1", quantity: "1", unitPriceUsd: "3200" }],
    issuedDaysAgo: 9,
    dueInDays: 4,
    sent: true,
    attempts: [
      {
        originAsset: DEMO_USDC_ON_ETHEREUM,
        path: ["KNOWN_DEPOSIT_TX", "REFUNDED"],
        startedDaysAgo: 5,
        settledDaysAgo: 5,
      },
    ],
  },
  {
    clientName: "Fernweh Labs",
    clientEmail: "billing@fernwehlabs.example",
    lines: [{ description: "Design system handoff", quantity: "1", unitPriceUsd: "1800" }],
    issuedDaysAgo: 4,
    dueInDays: 10,
    sent: true,
    attempts: [
      {
        originAsset: DEMO_USDC_ON_ARBITRUM,
        path: ["KNOWN_DEPOSIT_TX"],
        startedDaysAgo: 0,
      },
    ],
  },
  {
    clientName: "Bright Path Co",
    clientEmail: "hello@brightpath.example",
    lines: [{ description: "Landing page, 3 concepts", quantity: "3", unitPriceUsd: "450" }],
    issuedDaysAgo: 3,
    dueInDays: 11,
    sent: true,
    attempts: [
      {
        originAsset: DEMO_WNEAR,
        path: ["KNOWN_DEPOSIT_TX", "PROCESSING"],
        startedDaysAgo: 0,
      },
    ],
  },
  {
    clientName: "Northwind Studio",
    clientEmail: "ap@northwindstudio.example",
    memo: "Milestone 2 of the mobile app.",
    lines: [{ description: "Mobile app design, milestone 2", quantity: "1", unitPriceUsd: "4200" }],
    issuedDaysAgo: 21,
    dueInDays: null,
    sent: true,
    attempts: [
      {
        originAsset: DEMO_USDC_ON_ETHEREUM,
        path: ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"],
        startedDaysAgo: 18,
        settledDaysAgo: 18,
      },
    ],
  },
  {
    clientName: "Kestrel Health",
    clientEmail: "accounts@kestrelhealth.example",
    memo: "The client sent half of the deposit. The rest is still owed, or the shortfall goes back.",
    lines: [{ description: "Icon set, 40 glyphs", quantity: "40", unitPriceUsd: "18" }],
    issuedDaysAgo: 12,
    dueInDays: 2,
    sent: true,
    attempts: [
      {
        originAsset: DEMO_WNEAR,
        path: ["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT"],
        startedDaysAgo: 8,
        settledDaysAgo: 8,
      },
    ],
  },
  {
    clientName: "Fernweh Labs",
    clientEmail: "billing@fernwehlabs.example",
    memo: "Paid twice: the client's wallet retried after a slow first confirmation. The second deposit goes back to their refund address.",
    lines: [{ description: "Onboarding flow redesign", quantity: "1", unitPriceUsd: "2600" }],
    issuedDaysAgo: 16,
    dueInDays: null,
    sent: true,
    attempts: [
      {
        originAsset: DEMO_USDC_ON_ARBITRUM,
        path: ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"],
        startedDaysAgo: 14,
        settledDaysAgo: 14,
      },
      {
        originAsset: DEMO_USDC_ON_ARBITRUM,
        path: ["KNOWN_DEPOSIT_TX", "SUCCESS"],
        startedDaysAgo: 14,
        settledDaysAgo: 14,
      },
    ],
  },
  {
    clientName: "Bright Path Co",
    clientEmail: "hello@brightpath.example",
    lines: [{ description: "Workshop facilitation, 2 days", quantity: "2", unitPriceUsd: "450" }],
    issuedDaysAgo: 7,
    dueInDays: null,
    sent: true,
    cancelledDaysAgo: 5,
    attempts: [],
  },
  {
    clientName: "Ostro Games",
    clientEmail: "finance@ostrogames.example",
    memo: "Cancelled by mistake, then paid anyway — the payment is recorded against the cancelled invoice.",
    lines: [{ description: "Design ops setup", quantity: "1", unitPriceUsd: "1500" }],
    issuedDaysAgo: 11,
    dueInDays: null,
    sent: true,
    cancelledDaysAgo: 10,
    attempts: [
      {
        originAsset: DEMO_USDC_ON_ETHEREUM,
        path: ["KNOWN_DEPOSIT_TX", "SUCCESS"],
        startedDaysAgo: 9,
        settledDaysAgo: 9,
      },
    ],
  },
];

export async function findDemoUser(db: Database): Promise<User | null> {
  return findUserByNearAccount(db, DEMO_ACCOUNT_ID);
}

/**
 * The story as it already stands, or `null` when there is none.
 *
 * `pnpm demo` seeds once and reads afterwards, so a judge who restarts the app mid-talk keeps the
 * payments they have already walked instead of being handed a fresh story that contradicts the one
 * still on the projector. `--fresh` is what wipes it.
 */
export async function readDemoStory(db: Database): Promise<DemoSeed | null> {
  const user = await findDemoUser(db);
  if (!user) return null;

  const [destination, invoices] = await Promise.all([
    getActiveDestination(db, user.id),
    listInvoicesForUser(db, user.id, { limit: 50 }),
  ]);

  return {
    userId: user.id,
    destinationId: destination?.id ?? "",
    invoices: invoices.map((invoice) => ({
      invoiceId: invoice.id,
      publicId: invoice.publicId,
      number: invoice.number,
      clientName: invoice.clientName,
      status: invoice.status,
      total: invoice.total,
    })),
  };
}

/**
 * Remove every demo row, newest table first.
 *
 * Scoped to `is_demo` accounts, so a database that also holds a real sign-in keeps it. This is what
 * makes `reset` (S6.4) and a second `pnpm demo` idempotent instead of additive.
 */
export async function clearDemoData(db: Database): Promise<void> {
  const demoUsers = await db.select({ id: users.id }).from(users).where(eq(users.isDemo, true));
  const userIds = demoUsers.map((row) => row.id);
  if (userIds.length === 0) return;

  const owned = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(inArray(invoices.userId, userIds));
  const invoiceIds = owned.map((row) => row.id);
  if (invoiceIds.length > 0) {
    await db.delete(paymentAttempts).where(inArray(paymentAttempts.invoiceId, invoiceIds));
    await db.delete(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds));
    await db.delete(invoices).where(inArray(invoices.id, invoiceIds));
  }
  await db.delete(payoutDestinations).where(inArray(payoutDestinations.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
}

function daysAgo(nowMs: number, days: number): Date {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000);
}

function dateInDays(nowMs: number, days: number): string {
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Write the demo freelancer, their payout history and their ten invoices. */
export async function seedDemo(db: Database, options: SeedDemoOptions): Promise<DemoSeed> {
  const now = options.now ?? Date.now;
  const nowMs = now();

  const user = await upsertUserByNearAccount(db, {
    nearAccountId: DEMO_ACCOUNT_ID,
    displayName: DEMO_DISPLAY_NAME,
    email: DEMO_EMAIL,
    isDemo: true,
  });

  // Payout history: an EVM address used first, then the NEAR account Ada cashes out through today.
  await setActiveDestination(db, {
    userId: user.id,
    assetId: DEMO_USDC_ON_ETHEREUM,
    chain: "ethereum",
    address: DEMO_PAYOUT_ADDRESS_OLD,
  });
  const destination = await setActiveDestination(db, {
    userId: user.id,
    assetId: DEMO_USDC_ON_NEAR,
    chain: "near",
    address: DEMO_PAYOUT_ADDRESS,
  });
  for (const row of await listDestinations(db, user.id)) {
    const isCurrent = row.id === destination.id;
    await db
      .update(payoutDestinations)
      .set(
        isCurrent
          ? { createdAt: daysAgo(nowMs, 26) }
          : { createdAt: daysAgo(nowMs, 30), deactivatedAt: daysAgo(nowMs, 26) },
      )
      .where(eq(payoutDestinations.id, row.id));
  }

  const seeded: SeededDemoInvoice[] = [];

  for (const spec of DEMO_INVOICES) {
    const issuedAt = daysAgo(nowMs, spec.issuedDaysAgo);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: spec.clientName,
      clientEmail: spec.clientEmail,
      memo: spec.memo ?? null,
      dueDate: spec.dueInDays === null ? null : dateInDays(nowMs, spec.dueInDays),
      lines: spec.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: usdc(line.unitPriceUsd),
      })),
      // An invoice is a draft until it is sent, so the seed sends it the way the app does.
      status: "draft",
    });
    await db.update(invoices).set({ createdAt: issuedAt, updatedAt: issuedAt }).where(eq(invoices.id, invoice.id));

    if (spec.sent) {
      await setInvoiceStatus(db, { invoiceId: invoice.id, status: "open", at: issuedAt });
    }
    if (spec.cancelledDaysAgo !== undefined) {
      await cancelInvoice(db, invoice.id, daysAgo(nowMs, spec.cancelledDaysAgo));
    }

    for (const attemptSpec of spec.attempts) {
      const startedAt = daysAgo(nowMs, attemptSpec.startedDaysAgo);
      const settledAt =
        attemptSpec.settledDaysAgo === undefined ? null : daysAgo(nowMs, attemptSpec.settledDaysAgo);
      const refundTo = CLIENT_REFUND_ADDRESS[attemptSpec.originAsset] ?? "client.near";

      const row = await createPaymentAttempt(db, {
        invoiceId: invoice.id,
        payoutDestinationId: destination.id,
        originAsset: attemptSpec.originAsset,
        refundTo,
        quote: options.quoteFor({
          originAsset: attemptSpec.originAsset,
          recipient: destination.address,
          refundTo,
          amountOut: invoice.total,
          // A live quote stays open for another half hour; a finished one lapsed when it settled.
          deadline: (settledAt ?? new Date(nowMs + 30 * 60_000)).toISOString(),
        }),
      });

      for (const oneclickStatus of attemptSpec.path) {
        const updated = await recordAttemptStatus(db, {
          attemptId: row.id,
          oneclickStatus,
          depositTxHash: options.hashFor(`${invoice.publicId}:${attemptSpec.startedDaysAgo}:deposit`),
          deliveryTxHash:
            oneclickStatus === "SUCCESS"
              ? options.hashFor(`${invoice.publicId}:${attemptSpec.startedDaysAgo}:delivery`)
              : null,
          statusRaw: { demo: true, seeded: oneclickStatus },
          at: settledAt ?? new Date(nowMs),
        });
        if (!updated) throw new Error(`demo seed could not move attempt ${row.id} to ${oneclickStatus}`);
      }

      await db
        .update(paymentAttempts)
        .set({ createdAt: startedAt, updatedAt: settledAt ?? startedAt })
        .where(eq(paymentAttempts.id, row.id));
    }

    // Derived, not asserted: the status the dashboard shows is the one the app's own rule gives.
    const derived = await storeDerivedInvoiceStatus(db, {
      invoiceId: invoice.id,
      at: daysAgo(nowMs, spec.attempts[0]?.settledDaysAgo ?? spec.attempts[0]?.startedDaysAgo ?? spec.issuedDaysAgo),
    });
    if (derived === null) throw new Error(`demo seed lost invoice ${invoice.publicId}`);

    const finalRow = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    const stored = finalRow[0];
    if (!stored) throw new Error(`demo seed lost invoice ${invoice.publicId}`);

    seeded.push({
      invoiceId: invoice.id,
      publicId: invoice.publicId,
      number: invoice.number,
      clientName: spec.clientName,
      status: stored.status,
      total: invoice.total,
    });
  }

  return { userId: user.id, destinationId: destination.id, invoices: seeded };
}

/** The statuses the seed produced, for the script's summary and the tests that pin the story. */
export function demoStatuses(seed: DemoSeed): readonly InvoiceStatus[] {
  return seed.invoices.map((invoice) => invoice.status);
}
