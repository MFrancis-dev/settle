/**
 * The signed authorisation for a payout-destination change.
 * Roadmap: S4.2 · Spec: ARCHITECTURE.md §6 (changing a payout needs a fresh signature), PRD FR-6
 *
 * Same NEP-413 call as sign-in, over a different message: the message *is* the new destination, so a
 * signature cannot be re-used to authorise a different address. `addressConfirm` is the second typing
 * (FR-4) and travels outside the signature — the server compares it with the signed `address`, so a
 * mismatch is caught even though only one of the two was signed.
 */

import "./buffer-global";

import { payoutMessage } from "@/lib/core/payout-message";

import { createNonceBytes, type MessageSigner } from "./sign-in";

export interface PayoutBody {
  message: string;
  recipient: string;
  /** base64 of the 32 random bytes that were signed. */
  nonce: string;
  signature: string;
  publicKey: string;
  assetId: string;
  chain: string;
  address: string;
  addressConfirm: string;
}

export async function payoutBodyFromWallet(deps: {
  signer: MessageSigner;
  recipient: string;
  destination: { assetId: string; chain: string; address: string };
  /** The server-issued challenge nonce from `GET /api/auth/challenge` (#109); minted locally if absent. */
  nonce?: string;
  random?: (bytes: Uint8Array) => Uint8Array;
}): Promise<PayoutBody> {
  const { assetId, chain, address } = deps.destination;
  const message = payoutMessage(chain, address);
  const nonceBuffer =
    deps.nonce === undefined
      ? Buffer.from(createNonceBytes(deps.random))
      : Buffer.from(deps.nonce, "base64");

  const signed = await deps.signer.signMessage({
    message,
    recipient: deps.recipient,
    nonce: nonceBuffer,
  });
  if (!signed || !signed.signature || !signed.publicKey) {
    throw new Error("The wallet did not return a signed message.");
  }

  return {
    message,
    recipient: deps.recipient,
    nonce: nonceBuffer.toString("base64"),
    signature: signed.signature,
    publicKey: signed.publicKey,
    assetId,
    chain,
    address,
    addressConfirm: address,
  };
}
