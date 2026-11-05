/**
 * Single-use NEP-413 nonces: the replay guard behind sign-in and payout changes.
 * Roadmap: S3.1, S3.2 · Spec: ARCHITECTURE.md §5, §6
 *
 * A NEP-413 message is signed by the wallet, and nothing in it expires unless the wallet puts a
 * timestamp in `meta` — which Settle cannot require, because not every wallet does. So freshness is
 * enforced by *use*: a nonce that has already bought a session cannot buy a second one, and a
 * captured sign-in body cannot be replayed to change a payout address.
 *
 * The store is a per-process `Map`. That is correct for the MVP shape (one Next.js process plus one
 * worker, SD-3) and wrong for a horizontally-scaled deployment, where this becomes shared storage —
 * a fact `check-env` cannot detect, so it is written here instead.
 */

/** A nonce stays useful only as long as a client could plausibly still be finishing a signature. */
export const NONCE_TTL_MS = 10 * 60 * 1000;

/** A bound so a flood of unique nonces cannot grow the map without limit. */
export const NONCE_MAX_ENTRIES = 10_000;

export interface NonceStore {
  /** `true` the first time a nonce is seen, `false` for any repeat inside the window. */
  use(nonce: string): boolean;
  /** Nonces currently held — a test seam, and the number to watch if the cap ever bites. */
  size(): number;
}

export interface NonceStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** Injectable clock so tests never sleep. */
  now?: () => number;
}

export function createNonceStore(options: NonceStoreOptions = {}): NonceStore {
  const ttlMs = options.ttlMs ?? NONCE_TTL_MS;
  const maxEntries = options.maxEntries ?? NONCE_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const seen = new Map<string, number>();

  /** Expired entries are dropped first; if the map is still full, the oldest insertion goes. */
  function makeRoom(expiresAt: number): void {
    for (const [nonce, at] of seen) {
      if (at <= expiresAt - ttlMs) seen.delete(nonce);
    }
    while (seen.size >= maxEntries) {
      const oldest = seen.keys().next();
      if (oldest.done === true) return;
      seen.delete(oldest.value);
    }
  }

  return {
    use(nonce: string): boolean {
      const at = now();
      const spentAt = seen.get(nonce);
      // An entry past its window no longer counts as spent: the map is bounded by eviction anyway,
      // so holding a dead nonce would buy no protection while blocking a fresh signature.
      if (spentAt !== undefined && spentAt + ttlMs > at) return false;
      seen.delete(nonce);
      makeRoom(at);
      seen.set(nonce, at);
      return true;
    },
    size() {
      return seen.size;
    },
  };
}
