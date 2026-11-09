/**
 * Server-issued NEP-413 challenges: the replay guard behind sign-in and payout changes.
 * Roadmap: S3.1, S3.2, S7.12 (#109) · Spec: ARCHITECTURE.md §5, §6
 *
 * A NEP-413 message is signed by the wallet, and nothing in it expires unless the wallet puts a
 * timestamp in `meta` — which Settle cannot require, because not every wallet does. If the *client*
 * chose the nonce, freshness would be a client-side promise: a signature captured before it was ever
 * submitted would carry a nonce this process had not seen, and would buy a session forever. So the
 * nonce is minted here, handed out by `GET /api/auth/challenge`, and only a nonce that was issued and
 * is still inside its window can pass — single use, and dead once it expires.
 *
 * The store is a per-process `Map`. That is correct for the MVP shape (one Next.js process plus one
 * worker, SD-3) and wrong for a horizontally-scaled deployment, where this becomes shared storage —
 * a fact `check-env` cannot detect, so it is written here instead.
 */

/** NEP-413 fixes the nonce at exactly 32 bytes; the same width the client signs over. */
const NONCE_BYTES = 32;

/** How long an issued challenge stays spendable. Long enough to open a wallet and sign, short enough
 *  that a captured body stops being worth capturing. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** A bound so a flood of issued challenges cannot grow the map without limit. */
export const NONCE_MAX_ENTRIES = 10_000;

export interface NonceStore {
  /**
   * Mint a fresh challenge and remember it as issuable. Returns its base64 form, which is what the
   * wallet must sign and what `use` later matches. Pass `nonce` to register one already chosen (the
   * test fixtures sign over a fixed nonce before it reaches this store).
   */
  issue(nonce?: string): string;
  /** `true` only for a nonce we issued that is unspent and unexpired; spends it as a side effect. */
  use(nonce: string): boolean;
  /** Nonces currently held — a test seam, and the number to watch if the cap ever bites. */
  size(): number;
}

export interface NonceStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** Injectable clock so tests never sleep. */
  now?: () => number;
  /** Injectable randomness so the browser build need not reach for a CSPRNG in a test. */
  random?: (bytes: Uint8Array) => Uint8Array;
}

/** The two states a live nonce can be in, both aged out of the window after `ttlMs`. */
type NonceState = { spent: boolean; at: number };

export function createNonceStore(options: NonceStoreOptions = {}): NonceStore {
  const ttlMs = options.ttlMs ?? CHALLENGE_TTL_MS;
  const maxEntries = options.maxEntries ?? NONCE_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const random = options.random ?? ((bytes) => globalThis.crypto.getRandomValues(bytes));
  const held = new Map<string, NonceState>();

  /** Expired entries are dropped first; if the map is still full, the oldest insertion goes. */
  function makeRoom(at: number): void {
    for (const [nonce, state] of held) {
      if (state.at <= at - ttlMs) held.delete(nonce);
    }
    while (held.size >= maxEntries) {
      const oldest = held.keys().next();
      if (oldest.done === true) return;
      held.delete(oldest.value);
    }
  }

  return {
    issue(nonce?: string): string {
      const value = nonce ?? Buffer.from(random(new Uint8Array(NONCE_BYTES))).toString("base64");
      const at = now();
      held.delete(value);
      makeRoom(at);
      held.set(value, { spent: false, at });
      return value;
    },

    use(nonce: string): boolean {
      const at = now();
      const state = held.get(nonce);
      // Never issued, already spent, or past the window: none of them is a live challenge, and the
      // route's caller does not need to know which — the signature simply cannot be used again.
      if (state === undefined || state.spent || state.at + ttlMs <= at) return false;
      state.spent = true;
      return true;
    },

    size() {
      return held.size;
    },
  };
}
