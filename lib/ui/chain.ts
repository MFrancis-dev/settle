/**
 * Chain names and address hints for the screens that ask a person to type or read an address.
 * Roadmap: S4.2, S4.4 · Spec: PRD FR-4 ("the chain is named, not guessed")
 *
 * The id is what the API and the validator use; the label is what a human reads. Keeping them in one
 * map means a payout form can never name a chain the server would not validate against.
 */

import type { RefundChain } from "@/lib/core/address";

const LABELS: Record<RefundChain, string> = {
  near: "NEAR",
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  solana: "Solana",
  btc: "Bitcoin",
};

const HINTS: Record<RefundChain, string> = {
  near: "A NEAR account id, like name.near or a 64-character address",
  ethereum: "0x followed by 40 characters",
  base: "0x followed by 40 characters",
  arbitrum: "0x followed by 40 characters",
  solana: "32 to 44 characters, no 0, O, I or l",
  btc: "A Bitcoin address starting bc1, 1 or 3",
};

/** The human name for a chain id; unknown ids come back as given, so nothing is silently renamed. */
export function chainLabel(chain: string): string {
  const key = chain.toLowerCase();
  return key in LABELS ? LABELS[key as RefundChain] : chain;
}

export function addressHint(chain: string): string {
  const key = chain.toLowerCase();
  return key in HINTS ? HINTS[key as RefundChain] : "The address on that network";
}
