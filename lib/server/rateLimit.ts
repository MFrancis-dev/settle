/**
 * Token-bucket rate limits: the public pay routes and the signed-in writes.
 * Roadmap: S3.5 (quote spam control) · hardened per chain in S7.7 · Spec: ARCHITECTURE.md §6
 *
 * "Quote spam" is the threat this exists for (§6): every real quote costs the freelancer nothing
 * but our partner quota, and every dry quote is an unauthenticated call to 1Click. Buckets are
 * keyed by caller + invoice, so one abusive pay page cannot exhaust the limit for everyone else.
 *
 * In-process state, for the reason recorded in `lib/server/nonces.ts`.
 * No `server-only` marker: route tests and the worker import this under plain Node.
 */

import { rateLimited } from "./http";

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until a token is available again; only meaningful when `allowed` is false. */
  retryAfterS: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  /** Forget a key — the demo reset button and tests use it to start clean. */
  reset(key?: string): void;
}

export interface RateLimiterOptions {
  /** Bursts allowed before the steady rate applies. */
  capacity: number;
  /** Milliseconds to refill `capacity` tokens. */
  windowMs: number;
  now?: () => number;
}

/** Buckets older than this are pruned, so an attacker cannot pin memory with unique keys. */
const IDLE_MULTIPLIER = 4;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const capacity = options.capacity;
  const refillPerMs = capacity / options.windowMs;
  const idleMs = options.windowMs * IDLE_MULTIPLIER;
  const now = options.now ?? Date.now;

  const buckets = new Map<string, { tokens: number; at: number }>();

  return {
    check(key) {
      const at = now();
      const bucket = buckets.get(key);

      if (!bucket) {
        buckets.set(key, { tokens: capacity - 1, at });
        prune(at);
        return { allowed: true, retryAfterS: 0 };
      }

      bucket.tokens = Math.min(capacity, bucket.tokens + (at - bucket.at) * refillPerMs);
      bucket.at = at;

      if (bucket.tokens < 1) {
        return { allowed: false, retryAfterS: Math.ceil((1 - bucket.tokens) / refillPerMs / 1000) };
      }
      bucket.tokens -= 1;
      return { allowed: true, retryAfterS: 0 };
    },

    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };

  function prune(at: number): void {
    if (buckets.size < 1000) return;
    for (const [k, bucket] of buckets) {
      if (at - bucket.at > idleMs) buckets.delete(k);
    }
  }
}

/** A pay page can be re-opened, retried after a refund, and preview before paying: 6 real-or-dry quotes a minute. */
export const QUOTE_LIMIT = { capacity: 6, windowMs: 60_000 };

/** The open pay page polls about every 3 s; 60/min leaves headroom without being unlimited. */
export const STATUS_LIMIT = { capacity: 60, windowMs: 60_000 };

/**
 * Signed-in writes (S7.7): sign-in, payout change, invoice create and cancel, CSV export. Each of
 * these already needs a valid session — and a payout change needs a fresh wallet signature — so the
 * bucket is a brake on credential stuffing and on a script hammering one account, not a quota a
 * person can reach by using the app.
 */
export const AUTH_LIMIT = { capacity: 10, windowMs: 60_000 };

/**
 * The unauthenticated challenge mint (`GET /api/auth/challenge`, S7.12 / #109). One is needed per
 * sign-in attempt and per payout change, so a person on flaky mobile never hits it, while a script
 * trying to pre-mint a stock of nonces — or to probe the endpoint — is capped well below what would
 * fill the challenge store.
 */
export const CHALLENGE_LIMIT = { capacity: 30, windowMs: 60_000 };

/** Consume one token from `limiter`, or throw the 429 the caller must answer with. */
export function limit(limiter: RateLimiter, key: string): void {
  const decision = limiter.check(key);
  if (!decision.allowed) throw rateLimited(decision.retryAfterS);
}
