/**
 * S2.5 — NEP-413 verification rules, with signatures made by a throwaway ed25519 key.
 * Spec: ARCHITECTURE.md §5 · 🔍 the *shape* is from the standard, not a recorded wallet exchange
 *
 * What is under test here is the order of the checks as much as their result: the cryptographic
 * verdict comes first, because every other rule is only meaningful for a message that was
 * genuinely signed, and a key the account does not own is reported as `signature_mismatch` so
 * a failed login never tells an attacker which keys an account holds.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";

import { createNonce, verifyNep413, type Nep413Checks } from "./nep413";

const RECIPIENT = "settle.app";
const NONCE = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

const SECRET = new Uint8Array(32).map((_, index) => 200 - index);
const OTHER_SECRET = new Uint8Array(32).map((_, index) => index + 1);
const PUBLIC_KEY = `ed25519:${bs58.encode(ed25519.getPublicKey(SECRET))}`;
const OTHER_PUBLIC_KEY = `ed25519:${bs58.encode(ed25519.getPublicKey(OTHER_SECRET))}`;

const utf8 = (value: string) => new TextEncoder().encode(value);

/** The digest this module defines: `sha256("near:" + exact payload string)`. */
const digestOf = (payload: string) => sha256(utf8(`near:${payload}`));

function sign(payload: string, secret: Uint8Array = SECRET): string {
  return `ed25519:${bs58.encode(ed25519.sign(digestOf(payload), secret))}`;
}

interface MessageFields {
  message?: string;
  recipient?: string;
  callback?: string;
  nonce?: string;
  meta?: Record<string, unknown>;
  prehash?: string;
  [key: string]: unknown;
}

/**
 * Build `{payload, signature, publicKey}` the way a wallet hands it to `requestSignIn`.
 * The presented key is always `PUBLIC_KEY`; pass another secret to simulate a signer whose key
 * the account has never registered.
 */
function signedMessage(fields: MessageFields, secret: Uint8Array = SECRET) {
  const { meta, ...rest } = fields;
  const payload = JSON.stringify({
    message: "Settle: sign in to invoice 42",
    recipient: RECIPIENT,
    nonce: NONCE,
    ...rest,
    ...(meta === undefined
      ? {}
      : { meta: Buffer.from(JSON.stringify(meta), "utf8").toString("base64") }),
  });
  return { payload, signature: sign(payload, secret), publicKey: PUBLIC_KEY };
}

const checks: Nep413Checks = { expectedRecipient: RECIPIENT };

function reasonFor(input: unknown, opts: Partial<Nep413Checks> = {}): string {
  const result = verifyNep413(input, { ...checks, ...opts });
  return result.valid ? "valid" : result.reason;
}

describe("verifyNep413 accepts", () => {
  it("a correctly signed message, and returns its claims", () => {
    const input = signedMessage({
      callback: "https://settle.app/done",
      meta: { timestamp: 1_730_000_000_000 },
    });
    const result = verifyNep413(input, { ...checks, expectedNonce: NONCE });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims).toEqual({
      message: "Settle: sign in to invoice 42",
      recipient: RECIPIENT,
      callback: "https://settle.app/done",
      nonce: NONCE,
      issuedAtMs: 1_730_000_000_000,
      publicKey: PUBLIC_KEY,
    });
  });

  it("a message with app-defined extra fields, which the standard allows", () => {
    expect(reasonFor(signedMessage({ sessionId: "abc", recipient: RECIPIENT }))).toBe("valid");
  });

  it("a wallet that pre-hashes, by verifying over the digest it says it signed", () => {
    const signedBytes = sha256(utf8("the exact bytes this wallet signed"));
    const prehash = Buffer.from(signedBytes).toString("base64");
    // `prehash` is the digest itself: the prefix is inside what the wallet already hashed.
    const payload = JSON.stringify({ message: "hi", recipient: RECIPIENT, nonce: NONCE, prehash });
    const signature = `ed25519:${bs58.encode(ed25519.sign(signedBytes, SECRET))}`;
    expect(reasonFor({ payload, signature, publicKey: PUBLIC_KEY })).toBe("valid");
  });

  it("a signature over the payload without the `near:` prefix", () => {
    // Pins the digest rule: the prefix is what stops a signature being re-used for another chain.
    const payload = JSON.stringify({ message: "hi", recipient: RECIPIENT, nonce: NONCE });
    const unprefixed = `ed25519:${bs58.encode(ed25519.sign(sha256(utf8(payload)), SECRET))}`;
    expect(reasonFor({ payload, signature: unprefixed, publicKey: PUBLIC_KEY })).toBe(
      "signature_mismatch",
    );
  });
});

describe("verifyNep413 rejects", () => {
  it("a payload edited after signing", () => {
    const honest = signedMessage({ recipient: RECIPIENT });
    // Same signature, one claim changed: the classic way a signed login gets re-pointed.
    const tampered = {
      ...honest,
      payload: honest.payload.replace(RECIPIENT, "phishing.app"),
    };
    expect(reasonFor(tampered)).toBe("signature_mismatch");
  });

  it("a signature from a key that is not the one presented", () => {
    const honest = signedMessage({});
    expect(reasonFor({ ...honest, publicKey: OTHER_PUBLIC_KEY })).toBe("signature_mismatch");
  });

  it("a signature made by someone else's key", () => {
    expect(reasonFor(signedMessage({}, OTHER_SECRET))).toBe("signature_mismatch");
  });

  it("input that is not the three NEP-413 fields", () => {
    expect(reasonFor(undefined)).toBe("malformed_payload");
    expect(reasonFor({ payload: "x" })).toBe("malformed_payload");
    expect(reasonFor({ ...signedMessage({}), sig: "ed25519:1" })).toBe("malformed_payload");
    expect(
      reasonFor({ payload: "not json", signature: sign("not json"), publicKey: PUBLIC_KEY }),
    ).toBe("malformed_payload");
  });

  it("a message body missing a required claim", () => {
    expect(reasonFor(signedMessage({ nonce: "" }))).toBe("malformed_payload");
    expect(
      reasonFor({
        ...signedMessage({}),
        payload: JSON.stringify({ message: "hi", recipient: RECIPIENT }),
      }),
    ).toBe("malformed_payload");
  });

  it("a public key that is not 32 bytes of base58", () => {
    const short = { ...signedMessage({}), publicKey: "ed25519:3vAy2f9tXwP6MJ" };
    expect(reasonFor(short)).toBe("bad_public_key");
    const undecodable = { ...signedMessage({}), publicKey: "ed25519:0OIl0OIl0OIl" };
    expect(reasonFor(undecodable)).toBe("bad_public_key");
  });

  it("a signature that is not 64 bytes", () => {
    const truncated = { ...signedMessage({}), signature: "ed25519:3vAy2f9tXwP6MJ" };
    expect(reasonFor(truncated)).toBe("bad_signature_encoding");
  });

  it("a message signed for a different app", () => {
    const wrongRoom = signedMessage({});
    expect(reasonFor(wrongRoom, { expectedRecipient: "other-app" })).toBe("recipient_mismatch");
  });

  it("a nonce shorter than 32 bytes", () => {
    const weak = Buffer.from(new Uint8Array(8)).toString("base64");
    expect(reasonFor(signedMessage({ nonce: weak }))).toBe("nonce_too_short");
  });

  it("a nonce the server never issued", () => {
    expect(
      reasonFor(signedMessage({}), {
        expectedNonce: Buffer.from(new Uint8Array(32).fill(9)).toString("base64"),
      }),
    ).toBe("nonce_mismatch");
  });

  it("a signature outside the freshness window", () => {
    const issued = 1_730_000_000_000;
    const input = signedMessage({ meta: { timestamp: issued } });
    expect(reasonFor(input, { maxAgeMs: 60_000, now: () => issued + 61_000 })).toBe("stale");
    expect(reasonFor(input, { maxAgeMs: 60_000, now: () => issued + 59_000 })).toBe("valid");
  });

  it("a message with no timestamp when a freshness window is required", () => {
    expect(reasonFor(signedMessage({}), { maxAgeMs: 60_000 })).toBe("stale");
  });

  it("a valid signature from a key the account does not own", () => {
    // Reported as `signature_mismatch`: the distinction would leak which keys an account has.
    const foreign = signedMessage({});
    expect(reasonFor(foreign, { accountPublicKeys: [OTHER_PUBLIC_KEY] })).toBe(
      "signature_mismatch",
    );
    expect(reasonFor(foreign, { accountPublicKeys: [PUBLIC_KEY, OTHER_PUBLIC_KEY] })).toBe("valid");
  });

  it("a meta block that is not JSON, which simply carries no timestamp", () => {
    const payload = JSON.stringify({
      message: "hi",
      recipient: RECIPIENT,
      nonce: NONCE,
      meta: "not-base64-json",
    });
    const result = verifyNep413(
      { payload, signature: sign(payload), publicKey: PUBLIC_KEY },
      checks,
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims.issuedAtMs).toBeNull();
  });
});

describe("createNonce", () => {
  it("is 32 random bytes, base64", () => {
    const nonce = createNonce((bytes) => {
      bytes.fill(3);
      return bytes;
    });
    expect(Buffer.from(nonce, "base64")).toHaveLength(32);
    expect(nonce).toBe(Buffer.from(new Uint8Array(32).fill(3)).toString("base64"));
  });

  it("differs between calls, so two sessions cannot share one nonce", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
