/**
 * `payment_attempts` queries.
 * Roadmap: S2.9 · Spec: ARCHITECTURE.md §3.3, §4, §6
 *
 * A row here is the record of one real 1Click quote, and it is only ever written from a
 * signature-verified summary: `createPaymentAttempt` refuses a dry quote or a missing deposit
 * address, because an attempt without both is a page that tells a client to send funds nowhere.
 *
 * Status writes are guarded by `canTransition`, so a worker that reads a stale response cannot
 * walk an already-successful attempt back to `awaiting_deposit`.
 */

import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { customAlphabet } from "nanoid";

import type { BaseUnits, QuoteSummary } from "../../core/types";
import {
  ATTEMPT_STATUSES,
  attemptStatusFromOneClick,
  canTransition,
  TERMINAL_ATTEMPT_STATUSES,
  type AttemptStatus,
  type OneClickStatus,
} from "../../core/status";
import { parseBaseUnits } from "../../core/money";
import type { Database } from "../client";
import { paymentAttempts, invoices, type PaymentAttempt } from "../schema";

/** Everything that can still move: derived from the table, so a new status cannot be forgotten. */
const LIVE_ATTEMPT_STATUSES: AttemptStatus[] = ATTEMPT_STATUSES.filter(
  (status) => !TERMINAL_ATTEMPT_STATUSES.has(status),
);

/**
 * The receipt link's only credential (§6): 24 url-safe characters is ~144 bits, so a token cannot be
 * guessed and the route needs no session. Minted with the attempt so the pay page can offer the
 * receipt URL as soon as the status reaches `success`.
 */
const newReceiptToken = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-", 24);

export interface PaymentAttemptRecord extends PaymentAttempt {
  amountIn: BaseUnits;
  amountOut: BaseUnits;
  /** What landed on the deposit address, in origin-asset base units; `null` until 1Click reports it. */
  depositedAmount: BaseUnits | null;
  /** What went back to `refundTo`, in origin-asset base units; `null` unless it was refunded. */
  refundedAmount: BaseUnits | null;
}

export interface CreateAttemptInput {
  invoiceId: string;
  payoutDestinationId: string;
  /** Where the deposit is stored for the session's active attempt. */
  originAsset: string;
  refundTo: string;
  /** Must come from `requestInvoiceQuote` with `dry: false`. */
  quote: QuoteSummary;
}

function toRecord(row: PaymentAttempt): PaymentAttemptRecord {
  return {
    ...row,
    amountIn: parseBaseUnits(row.amountIn),
    amountOut: parseBaseUnits(row.amountOut),
    depositedAmount: row.depositedAmount === null ? null : parseBaseUnits(row.depositedAmount),
    refundedAmount: row.refundedAmount === null ? null : parseBaseUnits(row.refundedAmount),
  };
}

export async function createPaymentAttempt(
  db: Database,
  input: CreateAttemptInput,
): Promise<PaymentAttemptRecord> {
  const { quote } = input;
  if (quote.dry || quote.depositAddress === null) {
    throw new Error(
      "a payment attempt needs a verified non-dry quote with a deposit address (ARCHITECTURE.md §3.3)",
    );
  }

  const inserted = await db
    .insert(paymentAttempts)
    .values({
      invoiceId: input.invoiceId,
      payoutDestinationId: input.payoutDestinationId,
      originAsset: input.originAsset,
      refundTo: input.refundTo,
      depositAddress: quote.depositAddress,
      depositMemo: quote.depositMemo,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      feeUsd: quote.feeUsd,
      quoteDeadline: new Date(quote.deadline),
      quoteSignature: quote.signature,
      quoteRaw: quote.raw,
      receiptToken: newReceiptToken(),
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("createPaymentAttempt inserted no row");
  return toRecord(row);
}

/** The unique lookup the worker and the pay page use: a deposit address names exactly one attempt. */
export async function findAttemptByDepositAddress(
  db: Database,
  depositAddress: string,
): Promise<PaymentAttemptRecord | null> {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.depositAddress, depositAddress))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function findAttemptById(
  db: Database,
  id: string,
): Promise<PaymentAttemptRecord | null> {
  const rows = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, id));
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listAttemptsForInvoice(
  db: Database,
  invoiceId: string,
): Promise<readonly PaymentAttemptRecord[]> {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.invoiceId, invoiceId))
    .orderBy(desc(paymentAttempts.createdAt));
  return rows.map(toRecord);
}

/**
 * The attempt a client is currently paying: the newest one that has not reached a terminal
 * status. Expired and refunded attempts stay in the table (they are the audit trail) but stop
 * being the active one, which is what lets a client retry after a refund.
 */
export async function findActiveAttemptForInvoice(
  db: Database,
  invoiceId: string,
): Promise<PaymentAttemptRecord | null> {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.invoiceId, invoiceId),
        inArray(paymentAttempts.status, LIVE_ATTEMPT_STATUSES),
      ),
    )
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Every attempt that can still move, oldest first — the worker's polling set (S5.2).
 *
 * Not filtered by invoice: the worker has no user and no session, it works from the table. `limit`
 * bounds one tick so a backlog costs a slow loop rather than an unbounded burst of upstream reads.
 */
export async function listLiveAttempts(
  db: Database,
  options: { limit?: number } = {},
): Promise<readonly PaymentAttemptRecord[]> {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(inArray(paymentAttempts.status, LIVE_ATTEMPT_STATUSES))
    .orderBy(paymentAttempts.createdAt)
    .limit(options.limit ?? 100);
  return rows.map(toRecord);
}

/**
 * Live attempts of one seller that were quoted against a *different* payout destination (S7.8).
 *
 * An attempt stores the destination it was quoted with, and FR-6 says a payout change applies only
 * to new quotes — so these are the payments still on their way to the address the seller has just
 * replaced. The number exists so the settings screen can say it out loud instead of letting a change
 * look like it moved money that was already in flight.
 */
export async function countLiveAttemptsOnOtherDestination(
  db: Database,
  input: { userId: string; destinationId: string },
): Promise<number> {
  const rows = await db
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.userId, input.userId),
        inArray(paymentAttempts.status, LIVE_ATTEMPT_STATUSES),
        ne(paymentAttempts.payoutDestinationId, input.destinationId),
      ),
    );
  return rows.length;
}

/**
 * Attempts whose quote deadline has passed with no deposit seen (S5.3).
 *
 * `awaiting_deposit` *is* the "no deposit" half of the rule: the first status 1Click reports after
 * money lands is `KNOWN_DEPOSIT_TX`, so anything further along has a deposit by definition.
 */
export async function listExpiredQuoteAttempts(
  db: Database,
  input: { now: Date; limit?: number },
): Promise<readonly PaymentAttemptRecord[]> {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.status, "awaiting_deposit"),
        lt(paymentAttempts.quoteDeadline, input.now),
      ),
    )
    .orderBy(paymentAttempts.quoteDeadline)
    .limit(input.limit ?? 100);
  return rows.map(toRecord);
}

/**
 * Mark an attempt `expired`.
 *
 * Separate from `recordAttemptStatus` because expiry is not something 1Click reports: there is no
 * upstream status to map from. It is still guarded by `canTransition`, so an attempt that moved on
 * between the read and this write is refused rather than walked back — and `expired` is terminal,
 * which is why the caller checks upstream one last time first.
 */
export async function expireAttempt(
  db: Database,
  input: { attemptId: string; at?: Date },
): Promise<PaymentAttemptRecord | null> {
  const current = await findAttemptById(db, input.attemptId);
  if (!current) return null;
  if (current.status === "expired") return current;
  if (!canTransition(current.status, "expired")) return current;

  const updated = await db
    .update(paymentAttempts)
    .set({ status: "expired", updatedAt: input.at ?? new Date() })
    .where(and(eq(paymentAttempts.id, input.attemptId), eq(paymentAttempts.status, current.status)))
    .returning();

  // No row matched: somebody else moved this attempt while we were writing. Report what it is now
  // rather than the stale copy we read, so the caller re-derives the invoice from the truth.
  return updated[0] ? toRecord(updated[0]) : findAttemptById(db, input.attemptId);
}

export interface RecordStatusInput {
  attemptId: string;
  /** The raw 1Click status, when this write came from the API. */
  oneclickStatus?: OneClickStatus;
  depositTxHash?: string | null;
  deliveryTxHash?: string | null;
  /** Origin-asset base units that landed. Kept when this read does not report them. */
  depositedAmount?: BaseUnits | null;
  /** Origin-asset base units sent back to `refundTo`, and why. */
  refundedAmount?: BaseUnits | null;
  refundReason?: string | null;
  statusRaw?: unknown;
  receiptToken?: string | null;
  at?: Date;
}

/**
 * Move an attempt forward from what 1Click reported.
 *
 * Re-reporting the same status is idempotent (the worker polls), so it refreshes the raw payload
 * without a transition. An actual backward move throws: it means a stale read or a mapping bug,
 * and silently ignoring either would mis-report a payment.
 */
export async function recordAttemptStatus(
  db: Database,
  input: RecordStatusInput,
): Promise<PaymentAttemptRecord | null> {
  const current = await findAttemptById(db, input.attemptId);
  if (!current) return null;

  const next: AttemptStatus = input.oneclickStatus
    ? attemptStatusFromOneClick(input.oneclickStatus)
    : current.status;

  if (next !== current.status && !canTransition(current.status, next)) {
    throw new Error(
      `illegal attempt transition ${current.status} -> ${next} for ${input.attemptId}`,
    );
  }

  const at = input.at ?? new Date();
  const updated = await db
    .update(paymentAttempts)
    .set({
      status: next,
      oneclickStatus: input.oneclickStatus ?? current.oneclickStatus,
      depositTxHash: input.depositTxHash ?? current.depositTxHash,
      deliveryTxHash: input.deliveryTxHash ?? current.deliveryTxHash,
      // `?? current.*` rather than a straight overwrite: a poll that reports the status without the
      // amounts must not erase amounts an earlier poll recorded.
      depositedAmount: input.depositedAmount ?? current.depositedAmount,
      refundedAmount: input.refundedAmount ?? current.refundedAmount,
      refundReason: input.refundReason ?? current.refundReason,
      statusRaw: input.statusRaw ?? current.statusRaw,
      receiptToken: input.receiptToken ?? current.receiptToken,
      updatedAt: at,
    })
    .where(eq(paymentAttempts.id, input.attemptId))
    .returning();

  const row = updated[0];
  return row ? toRecord(row) : null;
}

/** True when nothing further can happen to this attempt, so the worker can stop polling it. */
export function isAttemptSettled(status: AttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}
