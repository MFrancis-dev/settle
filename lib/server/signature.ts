/**
 * The one place a signed message is checked: NEP-413 validity + account binding + single-use nonce.
 * Roadmap: S3.1, S3.2 · Spec: ARCHITECTURE.md §5, §6
 *
 * A NEP-413 payload proves *something* was signed; three more facts have to be established before a
 * handler can act on it — the key that signed it belongs to the account we think it does, the message
 * is addressed to this app, and (for a payout change) it quotes the very address being written. Doing
 * that in one function is what stops two routes from agreeing on everything except the check that
 * mattered.
 */

import {
  verifyNep413SignedMessage,
  type Nep413Claims,
  type SignatureRejection,
} from "../near/nep413";
import { signedMessageFields, type SignedMessageFields } from "../core/schemas";
import { unauthorized } from "./http";
import type { ServerDeps } from "./deps";

export interface SignedCheck {
  /** The account whose access keys must contain the signer. */
  accountId: string;
  /** When set, the signed `message` must equal this string exactly (a payout change does). */
  expectedMessage?: string;
}

export type SignedResult =
  { valid: true; claims: Nep413Claims } | { valid: false; reason: SignatureRejection };

/**
 * Parse the signed fields out of a request body (so a malformed body is a 400, not a 401), then verify
 * signature, recipient, account binding and nonce reuse.
 *
 * Freshness comes from the nonce store rather than a timestamp: a NEP-413 message only carries
 * `meta.timestamp` if the wallet puts it there, and Settle cannot require that of every wallet.
 */
export async function checkSignedMessage(
  deps: ServerDeps,
  body: unknown,
  check: SignedCheck,
): Promise<SignedResult> {
  const parsed = signedMessageFields.safeParse(body);
  if (!parsed.success) {
    return { valid: false, reason: "malformed_payload" };
  }
  return verifySigned(deps, parsed.data, check);
}

export async function verifySigned(
  deps: ServerDeps,
  signed: SignedMessageFields,
  check: SignedCheck,
): Promise<SignedResult> {
  const keys = await deps.accessKeys(check.accountId);
  // Only the signed fields go to the verifier: it rebuilds the Borsh payload from them, and the
  // route's extra fields (account id, new address) must not look like part of that payload.
  // `maxAgeMs` is not passed on purpose — the standard payload carries no timestamp, so the honest
  // freshness signal is the single-use nonce below, not a check this shape can never satisfy.
  const verified = verifyNep413SignedMessage(signed, {
    expectedRecipient: deps.expectedRecipient,
    accountPublicKeys: keys,
  });
  if (!verified.valid) return { valid: false, reason: verified.reason };

  if (check.expectedMessage !== undefined && verified.claims.message !== check.expectedMessage) {
    return { valid: false, reason: "message_mismatch" };
  }

  if (!deps.nonces.use(verified.claims.nonce)) {
    return { valid: false, reason: "replayed" };
  }

  return { valid: true, claims: verified.claims };
}

/** Verify, or answer 401 with the reason — the shape every signed route uses. */
export async function requireSigned(
  deps: ServerDeps,
  body: unknown,
  check: SignedCheck,
): Promise<Nep413Claims> {
  const result = await checkSignedMessage(deps, body, check);
  if (!result.valid) {
    throw unauthorized(`Signature rejected (${result.reason}).`, { reason: result.reason });
  }
  return result.claims;
}
