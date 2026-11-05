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

import { and, desc, eq, inArray } from "drizzle-orm";
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
import { paymentAttempts, type PaymentAttempt } from "../schema";

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

export interface RecordStatusInput {
  attemptId: string;
  /** The raw 1Click status, when this write came from the API. */
  oneclickStatus?: OneClickStatus;
  depositTxHash?: string | null;
  deliveryTxHash?: string | null;
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
