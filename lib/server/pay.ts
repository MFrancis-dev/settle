/**
 * The client's side of the API: the public invoice view, the token list, quotes, tx forwarding, status.
 * Roadmap: S3.4, S3.5, S3.6 · Spec: ARCHITECTURE.md §3.1, §3.2, §3.3, §6
 *
 * These routes are unauthenticated by nature — a client does not have a Settle account — so the three
 * controls that matter are all in this file: an unguessable `publicId` (§6, invoice enumeration), a
 * rate limit per pay page + caller (quote spam), and the rule that a deposit address only ever leaves
 * `requestInvoiceQuote()` after `verifyQuoteSignature()` passed. A payment's status is never taken
 * from the client either (§6, fake "paid"): it is read from 1Click and mapped through
 * `lib/core/status.ts`.
 */

import { SUPPORTED_CHAINS, validateAddress } from "../core/address";
import { deriveInvoiceStatus, type InvoiceStatus } from "../core/status";
import type { PayQuoteInput, SubmitTxInput } from "../core/schemas";
import type { QuoteSummary } from "../core/types";
import { getInvoiceByPublicId, setInvoiceStatus, type InvoiceRecord } from "../db/queries/invoices";
import {
  createPaymentAttempt,
  findActiveAttemptForInvoice,
  listAttemptsForInvoice,
  recordAttemptStatus,
  type PaymentAttemptRecord,
} from "../db/queries/paymentAttempts";
import { getActiveDestination } from "../db/queries/payoutDestinations";
import { findUserById } from "../db/queries/users";
import { OneClickError } from "../oneclick/client";
import { requestInvoiceQuote, type InvoiceQuoteParams } from "../oneclick/quote";
import { getExecutionStatus, submitDepositTx, type ExecutionStatus } from "../oneclick/status";
import { chainFromCode } from "../oneclick/tokens";
import { badRequest, conflict, HttpError, notFound, rateLimited } from "./http";
import { attemptView, invoiceView, moneyView, payUrlFor, type AttemptView, type MoneyView } from "./views";
import type { ServerDeps } from "./deps";

/** A settled invoice takes no new money; `paid_after_cancel` is settled too (§3.3). */
const ALREADY_PAID: readonly InvoiceStatus[] = ["paid", "overpaid", "paid_after_cancel"];

/**
 * Deposit windows per origin chain (§3.2: "now + per-origin-chain window"), in minutes.
 * 🔍 UNVERIFIED: 1Click does not publish these. The numbers are each chain's finality plus room for a
 * human opening a wallet; a quote that passes its deadline is refunded by the service, so guessing
 * wrong costs a retry and never moves funds. S0.8/#11 replaces this table with the vendor's figure.
 */
const DEADLINE_WINDOW_MINUTES: Readonly<Record<string, number>> = {
  near: 30,
  solana: 45,
  ethereum: 45,
  arbitrum: 45,
  base: 45,
};

const DEFAULT_DEADLINE_WINDOW_MINUTES = 30;

/** The deadline a quote is built with — also the row `expireQuotes` (S5.2) reads. */
export function deadlineForOriginChain(blockchain: string, nowMs: number): string {
  const minutes = DEADLINE_WINDOW_MINUTES[blockchain.toLowerCase()] ?? DEFAULT_DEADLINE_WINDOW_MINUTES;
  return new Date(nowMs + minutes * 60_000).toISOString();
}

export interface TokenOption {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  /** False when Settle cannot validate a refund address on that chain — so it is not offered. */
  refundSupported: boolean;
  /** The chain name in the form `lib/core/address.ts` understands. */
  settleChain: string | null;
}

export interface TokenList {
  /** What a client may pay in. */
  assets: TokenOption[];
  /** What a freelancer may be paid in — the same list, filtered to chains we can validate. */
  payoutAssets: TokenOption[];
}

/** `GET /api/tokens` — the cached list, so no page hardcodes an asset id or a decimal count. */
export async function tokenList(deps: ServerDeps): Promise<TokenList> {
  const toOption = (asset: {
    assetId: string;
    symbol: string;
    blockchain: string;
    decimals: number;
  }): TokenOption => {
    const chain = chainFromCode(asset.blockchain);
    return { ...asset, refundSupported: chain !== null, settleChain: chain };
  };

  const all = await deps.tokens.assets();
  const payout = await deps.tokens.payoutAssets();
  return { assets: all.map(toOption), payoutAssets: payout.map(toOption) };
}

async function requireInvoice(deps: ServerDeps, publicId: string): Promise<InvoiceRecord> {
  const invoice = await getInvoiceByPublicId(deps.db, publicId);
  // One 404 for "no such link" and "not yours": the route cannot be used to enumerate invoices (§6).
  if (!invoice) throw notFound("No such payment link.");
  return invoice;
}

/** §3.1: a pay page is for an open invoice. Anything else answers 409, never a silent quote. */
function assertPayable(invoice: InvoiceRecord): void {
  if (invoice.status === "cancelled") throw conflict("This invoice has been cancelled.");
  if (invoice.status === "draft") throw conflict("This invoice has not been sent yet.");
  if (ALREADY_PAID.includes(invoice.status)) {
    throw conflict(`This invoice is already ${invoice.status}.`);
  }
}

export interface PublicInvoiceView {
  publicId: string;
  number: string;
  /** Who is being paid — the seller's display name is the only identity a client is given. */
  seller: string;
  clientName: string;
  memo: string | null;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string | null;
  paidAt: string | null;
  total: MoneyView | null;
  payUrl: string;
  /** The quote the client is working from, while it is still live. */
  activeAttempt: AttemptView | null;
}

/**
 * `GET /api/pay/:publicId`.
 *
 * Minimal by §6: the seller's payout address is not here. A client needs the amount, who is asking,
 * and their own live deposit address — nothing that would help anybody else.
 */
export async function publicInvoice(deps: ServerDeps, publicId: string): Promise<PublicInvoiceView> {
  const invoice = await requireInvoice(deps, publicId);
  const seller = await findUserById(deps.db, invoice.userId);
  const destination = await getActiveDestination(deps.db, invoice.userId);
  const view = await invoiceView(deps, invoice, destination?.assetId ?? null);
  const active = await findActiveAttemptForInvoice(deps.db, invoice.id);

  return {
    publicId: invoice.publicId,
    number: invoice.number,
    seller: seller?.displayName ?? "Settle seller",
    clientName: invoice.clientName,
    memo: invoice.memo,
    status: invoice.status,
    issuedAt: view.createdAt,
    dueDate: invoice.dueDate,
    paidAt: view.paidAt,
    total: view.total,
    payUrl: payUrlFor(deps, invoice.publicId),
    activeAttempt: active ? await attemptView(deps, active) : null,
  };
}

export interface QuoteView {
  /** A dry quote is a preview: nothing was stored and no address exists yet. */
  dry: boolean;
  /** True when the live attempt was handed back instead of a second quote being taken. */
  reused: boolean;
  /** What the client sends, including the slippage buffer. */
  deposit: MoneyView;
  /** What the seller receives — the fixed side of an `EXACT_OUTPUT` quote. */
  payout: MoneyView;
  feeUsd: string | null;
  deadline: string;
  timeEstimateS: number | null;
  /** Non-null only for a real quote, and only with a signature-verified deposit address. */
  attempt: AttemptView | null;
}

export interface QuoteCall {
  publicId: string;
  /** The caller's address, for the per-invoice rate limit (§6, quote spam). */
  ip: string;
  input: PayQuoteInput;
}

function sameQuote(row: PaymentAttemptRecord, params: InvoiceQuoteParams): boolean {
  return row.originAsset === params.originAsset && row.refundTo === params.refundTo;
}

async function viewOfAttempt(
  deps: ServerDeps,
  attempt: PaymentAttemptRecord,
  payoutAssetId: string,
  reused: boolean,
): Promise<QuoteView> {
  return {
    dry: false,
    reused,
    deposit: await moneyView(deps, attempt.originAsset, attempt.amountIn),
    payout: await moneyView(deps, payoutAssetId, attempt.amountOut),
    feeUsd: attempt.feeUsd,
    deadline: attempt.quoteDeadline.toISOString(),
    timeEstimateS: null,
    attempt: await attemptView(deps, attempt),
  };
}

async function viewOfQuote(
  deps: ServerDeps,
  dry: boolean,
  summary: QuoteSummary,
  params: InvoiceQuoteParams,
): Promise<QuoteView> {
  return {
    dry,
    reused: false,
    deposit: await moneyView(deps, params.originAsset, summary.amountIn),
    payout: await moneyView(deps, params.destinationAsset, summary.amountOut),
    feeUsd: summary.feeUsd,
    deadline: summary.deadline,
    timeEstimateS: summary.timeEstimateS,
    attempt: null,
  };
}

/**
 * `POST /api/pay/:publicId/quote` — a preview (`dry`) or the address the client pays into.
 *
 * Four rules from §3.2 and §6 are enforced here:
 * - the payout side comes from the seller's **active destination**, never from the request;
 * - `refundTo` is validated against the *origin* chain, because that is where a short or excess
 *   deposit goes back to — a chain Settle cannot validate is refused rather than guessed at;
 * - one live attempt per invoice: re-asking for the same quote returns the same address (idempotent),
 *   and asking for a different one while an address is open is a 409, because two live quotes on one
 *   invoice is how a client pays twice and the seller gets an `overpaid` record;
 * - nothing is stored for a dry quote, and a real quote is stored only after its signature verified
 *   (`requestInvoiceQuote` throws otherwise, so an unverified address cannot reach the database).
 */
export async function quote(deps: ServerDeps, call: QuoteCall): Promise<QuoteView> {
  const decision = deps.quoteLimits.check(`${call.publicId}:${call.ip}`);
  if (!decision.allowed) throw rateLimited(decision.retryAfterS);

  const invoice = await requireInvoice(deps, call.publicId);
  assertPayable(invoice);

  const destination = await getActiveDestination(deps.db, invoice.userId);
  if (!destination) {
    throw conflict("The seller has not set a payout address for this invoice yet.");
  }

  const origin = await deps.tokens.find(call.input.originAsset);
  if (!origin) throw badRequest("That token is not on the 1Click list.", { originAsset: call.input.originAsset });

  const originChain = chainFromCode(origin.blockchain);
  if (originChain === null) {
    // #100: without a validator for that chain we cannot check where the client's refund goes,
    // and an uncheckable `refundTo` is how a short deposit becomes an unrecoverable one.
    throw badRequest(
      `Settle cannot take a refund address on ${origin.blockchain} yet. Choose a token on ${SUPPORTED_CHAINS.join(
        ", ",
      )}.`,
      { blockchain: origin.blockchain },
    );
  }

  const refund = validateAddress(originChain, call.input.refundTo);
  if (!refund.valid) throw badRequest(refund.reason, { chain: originChain });

  const params: InvoiceQuoteParams = {
    originAsset: origin.assetId,
    refundTo: call.input.refundTo,
    destinationAsset: destination.assetId,
    recipient: destination.address,
    amountOut: invoice.total,
    deadline: deadlineForOriginChain(origin.blockchain, deps.now()),
  };

  if (!call.input.dry) {
    const live = await findActiveAttemptForInvoice(deps.db, invoice.id);
    if (live && sameQuote(live, params)) {
      return viewOfAttempt(deps, live, destination.assetId, true);
    }
    if (live) {
      throw new HttpError(409, "conflict", "A payment address is already open for this invoice.", {
        attemptId: live.id,
        depositAddress: live.depositAddress,
        originAsset: live.originAsset,
      });
    }
  }

  // A rejected `QuoteSignatureError` or `amount_too_low` is mapped by `lib/server/http.ts`.
  const summary = await requestInvoiceQuote(deps.oneClick, params, {
    dry: call.input.dry,
    ...(deps.managerPublicKey === null ? {} : { managerPublicKey: deps.managerPublicKey }),
  });
  if (call.input.dry) return viewOfQuote(deps, true, summary, params);

  const attempt = await createPaymentAttempt(deps.db, {
    invoiceId: invoice.id,
    payoutDestinationId: destination.id,
    originAsset: origin.assetId,
    refundTo: call.input.refundTo,
    quote: summary,
  });
  // A fresh address means the client is paying again: after a refund or a failure the invoice goes
  // back to `open` (§3.3) so the dashboard and this pay page agree on what is still owed.
  await setInvoiceStatus(deps.db, {
    invoiceId: invoice.id,
    status: "open",
    at: new Date(deps.now()),
  });

  const view = await viewOfQuote(deps, false, summary, params);
  return { ...view, attempt: await attemptView(deps, attempt) };
}

export interface SubmitResult {
  attempt: AttemptView;
  /** False when 1Click could not be reached: the deposit is still coming, polling keeps working. */
  forwarded: boolean;
  oneclickStatus: string | null;
}

/**
 * `POST /api/pay/:publicId/submit-tx` — tell the service the deposit exists.
 *
 * §3.4: this is an optimisation, not a state change. A transport failure therefore answers 200 with
 * `forwarded: false` (the client did send the money); a rejected hash is a 4xx the client must see.
 * For a NEAR-origin deposit `refundTo` *is* the sending account, so it goes along as `nearSenderAccount`.
 */
export async function submitTx(
  deps: ServerDeps,
  call: { publicId: string; ip: string; input: SubmitTxInput },
): Promise<SubmitResult> {
  const decision = deps.quoteLimits.check(`submit:${call.publicId}:${call.ip}`);
  if (!decision.allowed) throw rateLimited(decision.retryAfterS);

  const invoice = await requireInvoice(deps, call.publicId);
  assertPayable(invoice);

  const attempt = await findActiveAttemptForInvoice(deps.db, invoice.id);
  if (!attempt) {
    throw conflict("There is no open payment for this invoice. Get a payment address first.");
  }

  const origin = await deps.tokens.find(attempt.originAsset);
  const nearSenderAccount = chainFromCode(origin?.blockchain ?? "") === "near" ? attempt.refundTo : undefined;

  try {
    const result = await submitDepositTx(deps.oneClick, {
      txHash: call.input.txHash,
      depositAddress: attempt.depositAddress,
      depositMemo: attempt.depositMemo,
      ...(nearSenderAccount === undefined ? {} : { nearSenderAccount }),
    });

    const updated = await recordAttemptStatus(deps.db, {
      attemptId: attempt.id,
      oneclickStatus: result.status,
      depositTxHash: call.input.txHash,
      at: new Date(deps.now()),
    });

    return {
      attempt: await attemptView(deps, updated ?? attempt),
      forwarded: true,
      oneclickStatus: result.status,
    };
  } catch (error) {
    if (error instanceof OneClickError && (error.kind === "unreachable" || error.kind === "server_error")) {
      return { attempt: await attemptView(deps, attempt), forwarded: false, oneclickStatus: null };
    }
    throw error;
  }
}

export interface StatusView {
  invoiceStatus: InvoiceStatus;
  /** Newest attempt, live or terminal — a paid invoice keeps showing the attempt that paid it. */
  attempt: AttemptView | null;
  /** False when 1Click could not be reached, so "no update" is never read as "not paid". */
  polled: boolean;
  pollReason: "no_attempt" | "upstream_not_found" | "upstream_unreachable" | null;
  paid: boolean;
  receiptUrl: string | null;
}

/**
 * `GET /api/pay/:publicId/status` — the pay page's poll.
 *
 * Writing from a public read is deliberate: it is the same idempotent, forward-only update the worker
 * does (§3.4), and it means a payment looks paid the moment the client asks. An *illegal* transition
 * is left to throw on purpose — that is a mapping bug, and swallowing it would mis-report a payment.
 */
export async function pollStatus(
  deps: ServerDeps,
  call: { publicId: string; ip: string },
): Promise<StatusView> {
  const decision = deps.statusLimits.check(`${call.publicId}:${call.ip}`);
  if (!decision.allowed) throw rateLimited(decision.retryAfterS);

  const invoice = await requireInvoice(deps, call.publicId);
  const attempts = await listAttemptsForInvoice(deps.db, invoice.id);
  const current = attempts[0] ?? null;

  if (!current) {
    return {
      invoiceStatus: invoice.status,
      attempt: null,
      polled: false,
      pollReason: "no_attempt",
      paid: false,
      receiptUrl: null,
    };
  }

  let upstream: ExecutionStatus | null = null;
  let pollReason: StatusView["pollReason"] = null;
  try {
    upstream = await getExecutionStatus(deps.oneClick, current.depositAddress, current.depositMemo);
  } catch (error) {
    if (error instanceof OneClickError && error.kind === "not_found") {
      pollReason = "upstream_not_found";
    } else if (
      error instanceof OneClickError &&
      (error.kind === "unreachable" || error.kind === "server_error")
    ) {
      pollReason = "upstream_unreachable";
    } else {
      throw error;
    }
  }

  let stored = current;
  if (upstream) {
    stored =
      (await recordAttemptStatus(deps.db, {
        attemptId: current.id,
        oneclickStatus: upstream.status,
        depositTxHash: upstream.depositTxHashes[0] ?? null,
        deliveryTxHash: upstream.deliveryTxHashes[0] ?? null,
        statusRaw: upstream.raw,
        at: new Date(deps.now()),
      })) ?? current;
  }

  const every = await listAttemptsForInvoice(deps.db, invoice.id);
  const derived = deriveInvoiceStatus({
    current: invoice.status,
    cancelled: invoice.cancelledAt !== null,
    attempts: every.map((row) => row.status),
  });
  const invoiceStatus =
    derived === invoice.status
      ? invoice.status
      : ((await setInvoiceStatus(deps.db, {
          invoiceId: invoice.id,
          status: derived,
          at: new Date(deps.now()),
        }))?.status ?? derived);

  const view = await attemptView(deps, stored);
  return {
    invoiceStatus,
    attempt: view,
    polled: upstream !== null,
    pollReason,
    paid: ALREADY_PAID.includes(invoiceStatus),
    receiptUrl: view.receiptUrl,
  };
}
