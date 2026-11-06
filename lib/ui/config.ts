/**
 * The client's own configuration — values a browser component may read.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §8
 *
 * Kept separate from `lib/server/env.ts` (which is `server-only` and holds secrets) so no client
 * component can reach a secret by importing the wrong module.
 */

import { z } from "zod";

/**
 * The chain network the wallet modules connect to. wallet-selector requires one of its two literal
 * ids; absent means the public one. Nothing in the UI prints this value.
 */
const networkSchema = z.enum(["mainnet", "testnet"]).default("mainnet");

export const NEAR_NETWORK: "mainnet" | "testnet" = networkSchema.parse(
  process.env.NEXT_PUBLIC_NEAR_NETWORK || undefined,
);

/**
 * The NEP-413 `recipient` field: the host the user is signing in to. The server compares it against
 * the host of `PUBLIC_APP_URL`, so reading it from the live origin keeps the two in step without
 * shipping a URL into the bundle.
 */
export function recipientFromLocation(): string {
  return window.location.hostname;
}

/** Wallet sessions and payouts are useless without a wallet, so the button degrades to disabled. */
export const WALLET_SUPPORTED =
  typeof window !== "undefined" && Boolean(window.crypto?.getRandomValues);
