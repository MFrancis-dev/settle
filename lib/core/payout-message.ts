/**
 * The exact string a wallet must sign to authorise a payout change.
 * Roadmap: S3.2 · Spec: ARCHITECTURE.md §6
 *
 * Shared because both sides have to agree byte-for-byte: the settings page renders this for signing
 * and `PUT /api/payout` hashes this exact text. Quoting the chain and address inside the message is
 * what makes a signature non-transferable — the signature for one address cannot authorise another.
 */

export function payoutMessage(chain: string, address: string): string {
  return `Settle payout change to ${address} on ${chain}`;
}
