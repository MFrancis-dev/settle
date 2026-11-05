/**
 * Builds the NEP-413 sign-in message a wallet signs, and the body `POST /api/session` receives.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5 (wallet sign-in flow), NEP-413
 *
 * Everything here is I/O-free except the injected wallet: the nonce comes from a passed-in random
 * function and the signature from a passed-in signer, so the whole shape is testable with a real
 * ed25519 key and no browser (see `sign-in.test.ts`, which checks its output against the wallet
 * library's own verifier).
 */

import "./buffer-global";

import type { SignedMessage } from "@near-wallet-selector/core";

/** NEP-413 fixes the nonce at exactly 32 bytes; the payload layout has no length prefix for it. */
export const NONCE_BYTES = 32;

/**
 * The body `POST /api/session` is sent for a wallet sign-in: the fields inside the signature, plus
 * the account id and the wallet's echoed state, which are *not* signed and are checked separately.
 */
export interface SignInBody {
  message: string;
  recipient: string;
  /** base64 of the 32 random bytes that were signed. */
  nonce: string;
  /** base64 ed25519 signature, exactly as the wallet returned it. */
  signature: string;
  /** "ed25519:<base58 key>". */
  publicKey: string;
  accountId: string;
  state?: string;
}

/** The part of the wallet interface this module needs; `Wallet.signMessage` satisfies it. */
export interface MessageSigner {
  signMessage(params: {
    message: string;
    recipient: string;
    nonce: Buffer;
    callbackUrl?: string;
  }): Promise<SignedMessage | void>;
}

/**
 * What the human sees in the wallet's dialog. It names the app and the host, because the signature is
 * only meaningful for one of them and the wallet cannot tell them apart any other way.
 */
export function signInMessage(recipient: string): string {
  return `Settle sign-in for ${recipient}`;
}

/** 32 random bytes from the caller's source of randomness (`crypto.getRandomValues` in the browser). */
export function createNonceBytes(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes),
): Uint8Array {
  return random(new Uint8Array(NONCE_BYTES));
}

/**
 * Ask the connected wallet to sign a fresh NEP-413 message and return the request body.
 *
 * The wallet returns `publicKey` and `signature` already in the transport form the verifier wants
 * (`ed25519:` + base58, base64 signature), so they are passed through unchanged — re-encoding here
 * would be a second place the two sides could drift.
 */
export async function signInBodyFromWallet(deps: {
  signer: MessageSigner;
  recipient: string;
  random?: (bytes: Uint8Array) => Uint8Array;
}): Promise<SignInBody> {
  const { signer, recipient } = deps;
  const message = signInMessage(recipient);
  const nonceBytes = createNonceBytes(deps.random);
  const nonceBuffer = Buffer.from(nonceBytes);

  const signed = await signer.signMessage({ message, recipient, nonce: nonceBuffer });
  if (!signed || !signed.accountId || !signed.signature || !signed.publicKey) {
    throw new Error("The wallet did not return a signed message.");
  }

  const body: SignInBody = {
    message,
    recipient,
    nonce: nonceBuffer.toString("base64"),
    signature: signed.signature,
    publicKey: signed.publicKey,
    accountId: signed.accountId,
  };
  // Only present when the wallet echoed one; an empty string would be a different signed payload.
  if (signed.state !== undefined) body.state = signed.state;
  return body;
}
