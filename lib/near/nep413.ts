/**
 * NEP-413 signed-message verification: signature, nonce, recipient, freshness.
 * Roadmap: S2.5 (JSON shape), S0.14 (published shape) · Spec: ARCHITECTURE.md §5
 * · https://nomdocs.near.org/build/standards/near-100-account-access/nep-413
 *
 * Two shapes are verified here, because two different signers produce them:
 *
 * - `verifyNep413` — the **JSON-payload** convention (`{payload, signature, publicKey}`, digest
 *   `sha256("near:" + payload)`, signature `ed25519:` base58). This is what the Near Intents / RAAT
 *   logins our signed routes accept produce, and what our fixtures sign.
 * - `verifyNep413SignedMessage` — the **published standard**, which is what wallet-selector wallets
 *   answer `signMessage()` with: Borsh-serialised `{tag u32 = 2**31 + 413, message, nonce[u8;32],
 *   recipient, callbackUrl?}`, digest `sha256` of those bytes, signature **base64**.
 *
 * ✅ Solved 2026-11-05 (S0.14): the second list is the wallet-selector behaviour, confirmed against
 * `@near-wallet-selector/core@10.1.4`'s own `serializeNep413` + `verifySignature` in
 * `nep413.test.ts`, so the byte layout is the library's, not our reading of the NEP. A wallet cannot
 * produce the first shape — it signs the payload it builds from its arguments, never a string the
 * dapp hands it — so real sign-in (Phase 4) goes through `verifyNep413SignedMessage`, and
 * `verifyNep413` stays for the RAAT-shaped bodies already on the wire. Both fail closed: the worst
 * outcome of a wrong reading here is a rejected login, never a moved payment.
 *
 * In the JSON shape the hash is taken over the **exact string the wallet signed** (`payload`), never
 * a re-serialisation of a parsed object: JSON key order and omitted-optional handling differ between
 * wallets, and a different byte for the same claim produces a different digest. The standard shape is
 * the exception the standard itself makes — its schema is a fixed struct with one unambiguous byte
 * layout, so reconstructing it from the fields is exact.
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
export type SignatureRejection = Nep413RejectReason | "message_mismatch" | "replayed";

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

/**
 * The wallet-selector / NEP-413 message fields, as the client sends them.
 *
 * Not `strict()`: the client's body also carries `accountId` and, for a wallet that echoed it,
 * `state`. Neither is inside the signed payload, so they belong to the route that reads them and
 * must not change the digest — while every field that *is* signed is required here, so an unsigned
 * substitute for one of them cannot be smuggled in.
 */
const signedMessageFieldsSchema = z.object({
  message: z.string().min(1).max(4096),
  recipient: z.string().min(1).max(64),
  /** base64 of the 32 random bytes, which the payload fixes at exactly 32. */
  nonce: z.string().min(1).max(64),
  /** Absent means the wallet signed `None`; an empty string is a *different* payload. */
  callbackUrl: z.string().min(1).max(2048).optional(),
  /** base64 of the 64-byte signature — base58 with an `ed25519:` prefix is the *public* key's form. */
  signature: z.string().min(1).max(128),
  publicKey: z.string().startsWith("ed25519:"),
});

/** The 4-byte tag every NEP-413 payload starts with: `2**31 + 413`. */
const NEP413_TAG = 2147484061;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Borsh writes `u32` little-endian, and a string as a `u32` byte-count followed by UTF-8. */
function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/**
 * The exact bytes a wallet signs. Exported so a test can compare it against the vendor's own
 * serialiser byte for byte; nothing in Settle's request path needs it.
 */
export function serializeNep413Payload(fields: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string;
}): Uint8Array {
  const message = utf8Bytes(fields.message);
  const recipient = utf8Bytes(fields.recipient);
  const callbackUrl = fields.callbackUrl === undefined ? null : utf8Bytes(fields.callbackUrl);
  const bytes = [
    ...le32(NEP413_TAG),
    ...le32(message.length),
    ...message,
    ...fields.nonce,
    ...le32(recipient.length),
    ...recipient,
    ...(callbackUrl === null ? [0] : [1, ...le32(callbackUrl.length), ...callbackUrl]),
  ];
  return Uint8Array.from(bytes);
}

/**
 * Verify a signed message in the published NEP-413 shape — what `wallet.signMessage()` returns.
 *
 * Same contract as `verifyNep413`: a reason code rather than a throw, cryptography first, and a key
 * the account has not registered reported as an ordinary `signature_mismatch`.
 *
 * One order difference, and it is forced: the nonce is *input* to the digest, so a nonce that is not
 * 32 bytes means there is no payload to check against. That is still answered before the recipient,
 * so nothing about the message leaks from a length the caller chose.
 */
export function verifyNep413SignedMessage(input: unknown, checks: Nep413Checks): Nep413Result {
  const parsed = signedMessageFieldsSchema.safeParse(input);
  if (!parsed.success) return { valid: false, reason: "malformed_payload" };
  const fields = parsed.data;

  const nonce = new Uint8Array(Buffer.from(fields.nonce, "base64"));
  if (nonce.length > NONCE_BYTES) return { valid: false, reason: "malformed_payload" };
  if (nonce.length < NONCE_BYTES) return { valid: false, reason: "nonce_too_short" };

  const publicKey = decodeEd25519(fields.publicKey);
  if (publicKey === null || publicKey.length !== 32) {
    return { valid: false, reason: "bad_public_key" };
  }

  const signature = new Uint8Array(Buffer.from(fields.signature, "base64"));
  if (signature.length !== 64) return { valid: false, reason: "bad_signature_encoding" };

  // `option<string>` means the field is present-or-absent, never present-empty: `callbackUrl` is
  // passed through exactly as parsed, so a client that omits it cannot be verified against `None`
  // by a server that filled it in with an empty string.
  const digest = sha256(
    serializeNep413Payload({
      message: fields.message,
      nonce,
      recipient: fields.recipient,
      ...(fields.callbackUrl === undefined ? {} : { callbackUrl: fields.callbackUrl }),
    }),
  );
  if (!ed25519.verify(signature, digest, publicKey)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  if (fields.recipient !== checks.expectedRecipient) {
    return { valid: false, reason: "recipient_mismatch" };
  }

  if (checks.expectedNonce !== undefined && fields.nonce !== checks.expectedNonce) {
    return { valid: false, reason: "nonce_mismatch" };
  }

  const claims: Nep413Claims = {
    message: fields.message,
    recipient: fields.recipient,
    callback: fields.callbackUrl ?? null,
    nonce: fields.nonce,
    // The standard payload has no timestamp — freshness is the nonce store's job (S3.1), so a
    // caller that asks for `maxAgeMs` here gets `stale`, which is the honest answer: this shape
    // cannot prove when it was signed.
    issuedAtMs: null,
    publicKey: fields.publicKey,
  };

  if (checks.maxAgeMs !== undefined) {
    return { valid: false, reason: "stale" };
  }

  if (
    checks.accountPublicKeys !== undefined &&
    !checks.accountPublicKeys.includes(claims.publicKey)
  ) {
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
