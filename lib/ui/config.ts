/**
 * The client's own configuration — values a browser component may read.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §8
 *
 * Kept separate from `lib/server/env.ts` (which is `server-only` and holds secrets) so no client
 * component can reach a secret by importing the wrong module.
 */

/**
 * The chain network the wallet modules connect to. Pinned to mainnet: NEAR Intents has no testnet
 * deployment and none is planned (vendor docs and hackathon Q-007, re-read 2026-11-10), so a wallet
 * on any other network could sign in but never pay or be paid. Demo mode and dry-run quotes are the
 * no-funds paths. Nothing in the UI prints this value.
 */
export const NEAR_NETWORK = "mainnet" as const;

/** Wallet sessions and payouts are useless without a wallet, so the button degrades to disabled. */
export const WALLET_SUPPORTED =
  typeof window !== "undefined" && Boolean(window.crypto?.getRandomValues);
