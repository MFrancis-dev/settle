/**
 * One place implements "read 1Click, write the attempt forward-only, re-derive the invoice".
 * Roadmap: S5.2 · Spec: ARCHITECTURE.md §3.4
 *
 * The pay page's status poll and the worker's `pollPayments` do the same job at different scales:
 * one attempt a client is watching, or every attempt that can still move. Sharing it is what keeps
 * §3.4's promise true — the write from a public read *is* the worker's write — instead of two
 * copies of the mapping drifting apart.
 *
 * Nothing here decides whether an upstream failure is an error. `not_found` and an unreachable
 * service come back as a reason with no write, because "no signal yet" must never be recorded as
 * "not paid" (§6).
 */

import type { InvoiceStatus } from "../core/status";
import type { Database } from "../db/client";
import { storeDerivedInvoiceStatus } from "../db/queries/invoices";
import { recordAttemptStatus, type PaymentAttemptRecord } from "../db/queries/paymentAttempts";
import { OneClickError, type OneClickClient } from "../oneclick/client";
import { getExecutionStatus, type ExecutionStatus } from "../oneclick/status";

export interface SyncDeps {
  readonly db: Database;
  readonly oneClick: OneClickClient;
  readonly now: () => number;
}

/** Why nothing was written. `null` means 1Click answered. */
export type SyncReason = "upstream_not_found" | "upstream_unreachable" | null;

export interface AttemptSync {
  /** The attempt as stored — unchanged when 1Click did not answer. */
  attempt: PaymentAttemptRecord;
  /** The invoice's status after re-deriving it from *every* attempt it has. */
  invoiceStatus: InvoiceStatus;
  polled: boolean;
  reason: SyncReason;
}

async function readUpstream(deps: SyncDeps, attempt: PaymentAttemptRecord) {
  try {
    const upstream = await getExecutionStatus(
      deps.oneClick,
      attempt.depositAddress,
      attempt.depositMemo,
    );
    return { upstream, reason: null };
  } catch (error) {
    if (error instanceof OneClickError && error.kind === "not_found") {
      return { upstream: null, reason: "upstream_not_found" as const };
    }
    if (
      error instanceof OneClickError &&
      (error.kind === "unreachable" || error.kind === "server_error")
    ) {
      return { upstream: null, reason: "upstream_unreachable" as const };
    }
    throw error;
  }
}

/** Write an upstream read to the attempt, then persist it. A backward move throws (§3.3). */
async function storeUpstream(
  deps: SyncDeps,
  attempt: PaymentAttemptRecord,
  upstream: ExecutionStatus,
): Promise<PaymentAttemptRecord> {
  const stored = await recordAttemptStatus(deps.db, {
    attemptId: attempt.id,
    oneclickStatus: upstream.status,
    depositTxHash: upstream.depositTxHashes[0] ?? null,
    deliveryTxHash: upstream.deliveryTxHashes[0] ?? null,
    depositedAmount: upstream.depositedAmount,
    refundedAmount: upstream.refundedAmount,
    refundReason: upstream.refundReason,
    statusRaw: upstream.raw,
    at: new Date(deps.now()),
  });
  return stored ?? attempt;
}

/**
 * Re-derive an invoice from every attempt it has and persist the result.
 *
 * The read-modify-write itself lives in `storeDerivedInvoiceStatus` (`lib/db/queries/invoices.ts`),
 * so the worker, this poll and the demo seed all derive an invoice the same way — `paid` vs
 * `overpaid` needs the whole attempt history, and there is one place that reads it. What stays here
 * is the meaning of a missing invoice: an attempt whose invoice is gone is a broken database, not a
 * status.
 */
export async function refreshInvoiceStatus(
  deps: SyncDeps,
  invoiceId: string,
): Promise<InvoiceStatus> {
  const stored = await storeDerivedInvoiceStatus(deps.db, {
    invoiceId,
    at: new Date(deps.now()),
  });
  if (stored === null) throw new Error(`invoice ${invoiceId} vanished under a payment attempt`);
  return stored;
}

/** One attempt, one upstream read, one forward-only write. */
export async function syncAttempt(
  deps: SyncDeps,
  attempt: PaymentAttemptRecord,
): Promise<AttemptSync> {
  const { upstream, reason } = await readUpstream(deps, attempt);
  const stored = upstream ? await storeUpstream(deps, attempt, upstream) : attempt;
  const invoiceStatus = await refreshInvoiceStatus(deps, stored.invoiceId);

  return { attempt: stored, invoiceStatus, polled: upstream !== null, reason };
}
