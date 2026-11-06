/**
 * Every 5 s: non-terminal attempts → `/v0/status` → update attempt + invoice.
 * Roadmap: S5.2 · Spec: ARCHITECTURE.md §3.4
 *
 * One tick is `pollPayments(deps)`, and everything it touches comes through `deps`, so a test runs a
 * single tick against a real database and a scripted 1Click `fetch` instead of waiting five seconds
 * or mocking our own code (AGENTS.md §8).
 *
 * A tick never throws. One attempt whose read fails — or whose status mapping is illegal — is logged
 * and counted, and the rest are still polled: the alternative is a single bad row silently freezing
 * every other payment in the queue behind it.
 */

import type { Database } from "../lib/db/client";
import { listLiveAttempts, type PaymentAttemptRecord } from "../lib/db/queries/paymentAttempts";
import type { OneClickClient } from "../lib/oneclick/client";
import { syncAttempt } from "../lib/server/sync";

/**
 * Attempts read per tick. A backlog therefore drains over several ticks rather than firing an
 * unbounded burst of upstream reads at 1Click in one go; the loop is 5 s, so 50 a tick is 600 a
 * minute, well past what a demo or a small business produces.
 */
export const POLL_BATCH = 50;

export interface WorkerDeps {
  readonly db: Database;
  readonly oneClick: OneClickClient;
  readonly now: () => number;
  /** Attempt ids and error kinds only — never an address, a name or a key (S7.10). */
  readonly log: (message: string) => void;
}

export interface PollTick {
  /** Attempts this tick looked at. */
  checked: number;
  /** Attempts whose status moved. */
  advanced: number;
  /** Attempts 1Click answered about, with no change — the common case. */
  unchanged: number;
  /** Attempts 1Click had no signal for yet (`not_found`, or the service was unreachable). */
  silent: number;
  /** Attempts whose read or write threw. Logged; the tick continued. */
  failed: number;
}

export const EMPTY_POLL_TICK: PollTick = {
  checked: 0,
  advanced: 0,
  unchanged: 0,
  silent: 0,
  failed: 0,
};

/** What a failed attempt logs. Deliberately no upstream body: it is not ours to put in a log. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
  return typeof error;
}

async function pollOne(deps: WorkerDeps, attempt: PaymentAttemptRecord, tick: PollTick): Promise<void> {
  try {
    const sync = await syncAttempt(deps, attempt);
    if (!sync.polled) {
      tick.silent += 1;
      return;
    }
    if (sync.attempt.status === attempt.status) tick.unchanged += 1;
    else tick.advanced += 1;
  } catch (error) {
    tick.failed += 1;
    deps.log(`pollPayments: attempt ${attempt.id} — ${describeFailure(error)}`);
  }
}

/** One tick of the loop. */
export async function pollPayments(deps: WorkerDeps, options: { limit?: number } = {}): Promise<PollTick> {
  const attempts = await listLiveAttempts(deps.db, { limit: options.limit ?? POLL_BATCH });
  const tick: PollTick = { ...EMPTY_POLL_TICK, checked: attempts.length };

  // Sequential on purpose: 1Click is a partner service, not ours to fan out against, and the
  // attempts are independent — order only decides which one is late when a tick runs long.
  for (const attempt of attempts) {
    await pollOne(deps, attempt, tick);
  }

  return tick;
}
