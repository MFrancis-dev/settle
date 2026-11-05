/**
 * NEP-413 signed-message verification: signature, nonce, recipient, freshness.
 * Roadmap: S2.5 · Spec: ARCHITECTURE.md §5 · https://nomdocs.near.org/build/standards/near-100-account-access/nep-413
 *
 * 🔍 UNVERIFIED AGAINST A LIVE WALLET — and the standard is not what this file implements.
 * NEP-413 as published Borsh-serialises `{message, nonce, recipient, callbackUrl}`, prepends the
 * 4-byte tag `2**31 + 413`, and signs `sha256` of that; the wallet answers with
 * `{accountId, publicKey, signature, state}`. This file instead verifies the **JSON payload**
 * shape (`{payload, signature, publicKey}`, `sha256("near:" + payload)`), which is the convention
 * the Near Intents / RAAT logins this app is built around actually produce. Which one the
 * wallet-selector package in S0.14 signs is the open question, so the first real login must be
 * checked against these rules — and the failure mode is a rejected sign-in, never a moved payment.
 *
 * The hash is taken over the **exact string the wallet signed** (`payload`), never over a
 * re-serialisation of a parsed object: JSON key order and omitted-optional handling differ
 * between wallets, and a different byte for the same claim produces a different digest.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { z } from "zod";

/** NEP-413 signs `sha256("near:" + payload)`; the prefix is part of the standard. */
const NEP413_PREFIX = "near:";

/** 32 bytes is what `crypto.getRandomValues` wallets put in `nonce`. */
const NONCE_BYTES = 32;

const signatureFieldsSchema = z
  .object({
    payload: z.string().min(2),
    signature: z.string().startsWith("ed25519:"),
    publicKey: z.string().startsWith("ed25519:"),
  })
  .strict();

/** The claim set a wallet signs. Extra app fields are allowed and ignored. */
const messageSchema = z
  .object({
    message: z.string().min(1),
    recipient: z.string().min(1),
    callback: z.string().url().optional(),
    nonce: z.string().min(1),
    /** Some wallets pre-hash: base64 of the 32 bytes that were actually signed. */
    prehash: z.string().min(1).optional(),
    /** App-defined base64 JSON; Settle puts its issued-at timestamp here. */
    meta: z.string().optional(),
  })
  .passthrough();

export interface Nep413Claims {
  message: string;
  recipient: string;
  callback: string | null;
  /** Raw base64 nonce as it appeared in the payload. */
  nonce: string;
  /** Milliseconds since epoch from `meta.timestamp`, when the wallet carried one. */
  issuedAtMs: number | null;
  publicKey: string;
}

export type Nep413Result =
  | { readonly valid: true; readonly claims: Nep413Claims }
  | { readonly valid: false; readonly reason: Nep413RejectReason };

export type Nep413RejectReason =
  | "malformed_payload"
  | "bad_public_key"
  | "bad_signature_encoding"
  | "signature_mismatch"
  | "recipient_mismatch"
  | "nonce_mismatch"
  | "nonce_too_short"
  | "stale";

/**
 * Everything a handler can be told back about a signature.
 * The last two are not cryptography failures: `message_mismatch` means the signed text does not quote
 * what the request asks for, and `replayed` comes from `lib/server/nonces.ts`, which refuses a nonce it
 * has already spent. With the recipient check, those are what make "a fresh NEP-413 signature" (§6)
 * mean something rather than "a signature that happens to be valid".
 */
export type SignatureRejection =
  | Nep413RejectReason
  | "message_mismatch"
  | "replayed";

export interface Nep413Checks {
  /** Who the message must name as recipient — pins it to this app (replay across apps). */
  expectedRecipient: string;
  /** The nonce issued for this session; absent means "any well-formed nonce" (no replay guard). */
  expectedNonce?: string;
  /** Reject signatures older than this, when the payload carries a timestamp. */
  maxAgeMs?: number;
  /**
   * The account's registered keys, read with `getAccessKeys` (S2.6). A signature from a key the
   * account does not own proves nothing about the account, so this is required to bind a
   * signature to a NEAR account id.
   */
  accountPublicKeys?: readonly string[];
  now?: () => number;
}

function decodeEd25519(value: string): Uint8Array | null {
  const body = value.slice("ed25519:".length);
  try {
    const bytes = bs58.decode(body);
    return bytes.length === 32 || bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

function readIssuedAt(meta: string | undefined): number | null {
  if (meta === undefined) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(meta, "base64").toString("utf8")) as unknown;
  } catch {
    return null;
  }
  const parsed = z.object({ timestamp: z.union([z.number(), z.string()]) }).safeParse(json);
  if (!parsed.success) return null;
  const value = Number(parsed.data.timestamp);
  return Number.isFinite(value) ? value : null;
}

/**
 * The message the ed25519 signature is checked against.
 * Without `prehash` that is `sha256("near:" + payload)`. With it, the wallet says "these are the
 * 32 bytes I signed" — a hardware wallet that cannot sign arbitrary text — so they are used as
 * the digest and are *not* prefixed or re-hashed. 🔍 unverified: no wallet in S0.14 has been
 * checked against this branch, and a wrong reading here fails closed (a rejected sign-in).
 */
function digestOf(payload: string, prehash: string | undefined): Uint8Array {
  if (prehash === undefined) {
    const prefix = new TextEncoder().encode(NEP413_PREFIX);
    const body = new TextEncoder().encode(payload);
    const combined = new Uint8Array(prefix.length + body.length);
    combined.set(prefix, 0);
    combined.set(body, prefix.length);
    return sha256(combined);
  }
  const bytes = new Uint8Array(Buffer.from(prehash, "base64"));
  return bytes.length === 32 ? bytes : sha256(bytes);
}

/**
 * Verify a NEP-413 signature and its claims in one pass, returning *why* it failed rather than
 * throwing, so a login handler can answer 401 with a reason that never leaks a secret.
 *
 * Order matters: the cryptographic check runs first because every other check is only
 * meaningful for a message that was genuinely signed.
 */
export function verifyNep413(input: unknown, checks: Nep413Checks): Nep413Result {
  const signed = signatureFieldsSchema.safeParse(input);
  if (!signed.success) return { valid: false, reason: "malformed_payload" };

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(signed.data.payload) as unknown;
  } catch {
    // A wallet can hand back anything in `payload`; this is a 401 with a reason, never a throw,
    // because a login handler must not be able to crash on untrusted input.
    return { valid: false, reason: "malformed_payload" };
  }

  const message = messageSchema.safeParse(payloadJson);
  if (!message.success) return { valid: false, reason: "malformed_payload" };

  const publicKey = decodeEd25519(signed.data.publicKey);
  if (publicKey === null || publicKey.length !== 32) {
    return { valid: false, reason: "bad_public_key" };
  }

  const signature = decodeEd25519(signed.data.signature);
  if (signature === null || signature.length !== 64) {
    return { valid: false, reason: "bad_signature_encoding" };
  }

  if (!ed25519.verify(signature, digestOf(signed.data.payload, message.data.prehash), publicKey)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  if (message.data.recipient !== checks.expectedRecipient) {
    return { valid: false, reason: "recipient_mismatch" };
  }

  const nonceBytes = Buffer.from(message.data.nonce, "base64");
  if (nonceBytes.length < NONCE_BYTES) return { valid: false, reason: "nonce_too_short" };
  if (checks.expectedNonce !== undefined && message.data.nonce !== checks.expectedNonce) {
    return { valid: false, reason: "nonce_mismatch" };
  }

  const claims: Nep413Claims = {
    message: message.data.message,
    recipient: message.data.recipient,
    callback: message.data.callback ?? null,
    nonce: message.data.nonce,
    issuedAtMs: readIssuedAt(message.data.meta),
    publicKey: signed.data.publicKey,
  };

  if (checks.maxAgeMs !== undefined) {
    const now = (checks.now ?? Date.now)();
    if (claims.issuedAtMs === null || now - claims.issuedAtMs > checks.maxAgeMs) {
      return { valid: false, reason: "stale" };
    }
  }

  if (
    checks.accountPublicKeys !== undefined &&
    !checks.accountPublicKeys.includes(claims.publicKey)
  ) {
    // Not a separate reason code: an unbound key is the same 401 as a wrong signature, but the
    // distinction would only help an attacker probe which keys an account owns.
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, claims };
}

/** A nonce to hand to the wallet: 32 random bytes, base64, stored server-side for the check. */
export function createNonce(
  random: (bytes: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b),
): string {
  return Buffer.from(random(new Uint8Array(NONCE_BYTES))).toString("base64");
}
