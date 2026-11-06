/**
 * Every 60 s: past-deadline attempts with no deposit → `expired`.
 * Roadmap: S5.3 · Spec: ARCHITECTURE.md §3.4, §3.3
 *
 * The rule is "deadline passed **and no deposit**", and the second half is checked against 1Click one
 * last time rather than trusted from our own row. `expired` is terminal and absorbs: if money landed
 * in the seconds before the deadline and we expired it anyway, the attempt can never be corrected —
 * the next read would be `SUCCESS` on an `expired` row, which `canTransition` refuses. One extra read
 * per expired quote is cheap against that.
 *
 * When 1Click is *unreachable* the attempt is left alone and retried next minute. Nothing is lost by
 * waiting — an expired quote is refunded by the service on its own deadline — and expiring on a
 * network failure is exactly the unrecoverable mistake above. A 404 is different: the service keeps
 * no record of that deposit address, so no deposit can ever be reported for it, and leaving the row
 * live would wedge the invoice (one live attempt per invoice, so the client could never get a new
 * address).
 */

import {
  expireAttempt,
  listExpiredQuoteAttempts,
  type PaymentAttemptRecord,
} from "../lib/db/queries/paymentAttempts";
import { refreshInvoiceStatus, syncAttempt } from "../lib/server/sync";
import type { WorkerDeps } from "./pollPayments";

/** Candidates examined per tick. Same reasoning as `POLL_BATCH`: a backlog drains, it does not burst. */
export const EXPIRE_BATCH = 50;

export interface ExpireTick {
  /** Past-deadline, no-deposit attempts this tick looked at. */
  checked: number;
  /** Marked `expired`, with the invoice re-derived (back to `open`, so the client can retry). */
  expired: number;
  /** The last read showed money after all: recorded forward instead of expired. */
  lateDeposit: number;
  /** 1Click was unreachable, so the decision is deferred to the next tick. */
  deferred: number;
  /** Candidates whose read or write threw. Logged; the tick continued. */
  failed: number;
}

export const EMPTY_EXPIRE_TICK: ExpireTick = {
  checked: 0,
  expired: 0,
  lateDeposit: 0,
  deferred: 0,
  failed: 0,
};

function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
  return typeof error;
}

/**
 * Which rows to consider. Injected by a test that wants to hand the tick one specific row; left out,
 * the tick runs the real query — the same one `worker/index.ts` uses in production.
 */
export interface ExpireDeps extends WorkerDeps {
  readonly candidates?: () => Promise<readonly PaymentAttemptRecord[]>;
}

function defaultCandidates(deps: ExpireDeps): () => Promise<readonly PaymentAttemptRecord[]> {
  return () =>
    listExpiredQuoteAttempts(deps.db, { now: new Date(deps.now()), limit: EXPIRE_BATCH });
}

async function expireOne(deps: ExpireDeps, attempt: PaymentAttemptRecord, tick: ExpireTick): Promise<void> {
  try {
    const sync = await syncAttempt(deps, attempt);

    // Money landed, late but real. `syncAttempt` already wrote it forward-only; do not expire.
    if (sync.attempt.status !== "awaiting_deposit") {
      tick.lateDeposit += 1;
      return;
    }

    if (sync.reason === "upstream_unreachable") {
      tick.deferred += 1;
      deps.log(`expireQuotes: attempt ${attempt.id} deferred, 1Click unreachable`);
      return;
    }

    const stored = await expireAttempt(deps.db, { attemptId: attempt.id, at: new Date(deps.now()) });
    const invoiceStatus = await refreshInvoiceStatus(deps, stored?.invoiceId ?? attempt.invoiceId);
    if (stored?.status === "expired") {
      tick.expired += 1;
      deps.log(`expireQuotes: attempt ${attempt.id} expired, invoice ${invoiceStatus}`);
    } else {
      // Somebody moved it between the read and the write — the pay page polling, or another worker.
      tick.lateDeposit += 1;
    }
  } catch (error) {
    tick.failed += 1;
    deps.log(`expireQuotes: attempt ${attempt.id} — ${describeFailure(error)}`);
  }
}

/** One tick of the loop. */
export async function expireQuotes(deps: ExpireDeps): Promise<ExpireTick> {
  const attempts = await (deps.candidates ?? defaultCandidates(deps))();
  const tick: ExpireTick = { ...EMPTY_EXPIRE_TICK, checked: attempts.length };

  for (const attempt of attempts) {
    await expireOne(deps, attempt, tick);
  }

  return tick;
}
