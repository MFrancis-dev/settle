/**
 * NEAR implicit account ids: the 64-character hex form of an ed25519 public key.
 * Roadmap: S0.10 (#13) · Spec: https://docs.near.org/protocol/accounts-contracts/account-id
 *
 * Verified against the worked example in the docs rather than from memory: an implicit account needs
 * no creation step, so sending tokens to the hex address materialises it. That is what lets an agent
 * prepare the storage payer and the human fund it in one paste, with no key ever passing through a
 * chat log.
 */

import bs58 from "bs58";

/** `ed25519:` is how NEAR writes a key on the wire and in `access_keys`; the rest is base58. */
const ED25519_PREFIX = "ed25519:";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The account id that key controls. Throws rather than returning a plausible-looking id: a wrong
 * payer address would send the storage deposit to someone else, and it is unrecoverable.
 */
export function implicitAccountFromPublicKey(publicKey: string): string {
  const body = publicKey.startsWith(ED25519_PREFIX)
    ? publicKey.slice(ED25519_PREFIX.length)
    : publicKey;

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(body);
  } catch {
    throw new Error(`Not a base58 ed25519 public key: it cannot be decoded`);
  }
  if (bytes.length !== 32) {
    throw new Error(`Not an ed25519 public key: it decodes to ${bytes.length} bytes, not 32`);
  }
  return toHex(bytes);
}

/** A 64-hex address, i.e. an account that exists as soon as it holds tokens. */
export function isImplicitAccount(accountId: string): boolean {
  return /^[0-9a-f]{64}$/.test(accountId);
}
