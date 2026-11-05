/**
 * S2.5 + S0.14 — NEP-413 verification rules, with signatures made by a throwaway ed25519 key.
 * Spec: ARCHITECTURE.md §5 · the published shape is checked against `@near-wallet-selector/core`
 * itself, so its byte layout is the library's, not our reading of the NEP — a real wallet exchange
 * is still the one thing only a live sign-in can prove (🔍).
 *
 * What is under test here is the order of the checks as much as their result: the cryptographic
 * verdict comes first, because every other rule is only meaningful for a message that was
 * genuinely signed, and a key the account does not own is reported as `signature_mismatch` so
 * a failed login never tells an attacker which keys an account holds.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
// S0.14: the reference implementation of the shape below is the library real logins use, so the
// byte layout is checked against it rather than against our reading of the NEP.
import { serializeNep413, verifySignature as vendorVerifySignature } from "@near-wallet-selector/core";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";

import {
  createNonce,
  serializeNep413Payload,
  verifyNep413,
  verifyNep413SignedMessage,
  type Nep413Checks,
} from "./nep413";

const RECIPIENT = "settle.app";
const NONCE = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

/** The published shape fixes the nonce at `[u8; 32]`. */
const NONCE32 = new Uint8Array(32).fill(7);
const NONCE_B64 = Buffer.from(NONCE32).toString("base64");

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

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

interface StandardFields {
  message?: string;
  recipient?: string;
  nonce?: string;
  callbackUrl?: string;
}

/**
 * Build and sign a published-shape message the way a wallet does: Borsh payload, `sha256` over it,
 * base64 signature. `callbackUrl` is passed through as present-or-absent, never as an empty string.
 */
function signedStandard(fields: StandardFields, secret: Uint8Array = SECRET) {
  const message = fields.message ?? "Settle: sign in to invoice 42";
  const recipient = fields.recipient ?? RECIPIENT;
  const nonce = fields.nonce ?? NONCE_B64;
  const callbackUrl = fields.callbackUrl;
  const digest = sha256(
    serializeNep413Payload({
      message,
      recipient,
      nonce: new Uint8Array(Buffer.from(nonce, "base64")),
      ...(callbackUrl === undefined ? {} : { callbackUrl }),
    }),
  );
  return {
    message,
    recipient,
    nonce,
    ...(callbackUrl === undefined ? {} : { callbackUrl }),
    signature: Buffer.from(ed25519.sign(digest, secret)).toString("base64"),
    publicKey: PUBLIC_KEY,
  };
}

function reasonForStandard(input: unknown, opts: Partial<Nep413Checks> = {}): string {
  const result = verifyNep413SignedMessage(input, { ...checks, ...opts });
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

describe("verifyNep413SignedMessage — the published NEP-413 shape", () => {
  it("builds the exact bytes wallet-selector signs", () => {
    const cases = [
      { message: "Settle: sign in", recipient: RECIPIENT, nonce: NONCE32 },
      { message: "ünïcöde 中文", recipient: RECIPIENT, nonce: NONCE32 },
      {
        message: "Settle payout change to 0xabc on NEAR",
        recipient: RECIPIENT,
        nonce: NONCE32,
        callbackUrl: "https://settle.app/done",
      },
    ];

    for (const fields of cases) {
      expect(hex(serializeNep413Payload(fields))).toBe(
        // The vendor takes `nonce` as a Buffer and writes the schema itself.
        hex(Buffer.from(serializeNep413({ ...fields, nonce: Buffer.from(fields.nonce) }))),
      );
    }
  });

  it("opens with the tag 2**31 + 413, little-endian", () => {
    const bytes = serializeNep413Payload({ message: "a", recipient: RECIPIENT, nonce: NONCE32 });
    expect([...bytes.slice(0, 4)]).toEqual([0x9d, 0x01, 0x00, 0x80]);
  });

  it("agrees with the vendor in both directions", () => {
    const signed = signedStandard({});
    // Our digest, the vendor's verifier.
    expect(
      vendorVerifySignature({
        publicKey: PUBLIC_KEY,
        signature: signed.signature,
        message: signed.message,
        nonce: Buffer.from(signed.nonce, "base64"),
        recipient: signed.recipient,
      }),
    ).toBe(true);

    // The vendor's serialiser, our verifier: what a wallet builds, signed by a throwaway key.
    const digest = sha256(
      Uint8Array.from(
        serializeNep413({ message: "hi", nonce: Buffer.from(NONCE32), recipient: RECIPIENT }),
      ),
    );
    const signature = Buffer.from(ed25519.sign(digest, SECRET)).toString("base64");
    expect(
      reasonForStandard(
        { message: "hi", recipient: RECIPIENT, nonce: NONCE_B64, signature, publicKey: PUBLIC_KEY },
        { expectedNonce: NONCE_B64 },
      ),
    ).toBe("valid");
  });

  it("accepts a well-formed message and returns its claims", () => {
    const input = signedStandard({ callbackUrl: "https://settle.app/done" });
    const result = verifyNep413SignedMessage(input, { ...checks, expectedNonce: NONCE_B64 });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims).toEqual({
      message: "Settle: sign in to invoice 42",
      recipient: RECIPIENT,
      callback: "https://settle.app/done",
      nonce: NONCE_B64,
      // The standard payload carries no timestamp; freshness is the nonce store's job.
      issuedAtMs: null,
      publicKey: PUBLIC_KEY,
    });
  });

  it("ignores body fields that are not part of the signed payload", () => {
    // `accountId` belongs to the route and `state` is echoed by the wallet; neither is signed, so
    // neither may change the verdict.
    expect(
      reasonForStandard({ ...signedStandard({}), accountId: "freelancer.testnet", state: "xyz" }),
    ).toBe("valid");
  });

  it("rejects a message edited after signing", () => {
    const signed = signedStandard({});
    expect(
      reasonForStandard({ ...signed, message: `${signed.message} and take the payout elsewhere` }),
    ).toBe("signature_mismatch");
  });

  it("rejects a signature from a key the account does not list", () => {
    const signed = signedStandard({});
    expect(reasonForStandard(signed, { accountPublicKeys: [OTHER_PUBLIC_KEY] })).toBe(
      "signature_mismatch",
    );
    expect(reasonForStandard(signed, { accountPublicKeys: [PUBLIC_KEY] })).toBe("valid");
  });

  it("requires a base64 signature, not the base58 form the JSON shape uses", () => {
    const digest = sha256(
      serializeNep413Payload({ message: "hi", recipient: RECIPIENT, nonce: NONCE32 }),
    );
    const base58Signature = `ed25519:${bs58.encode(ed25519.sign(digest, SECRET))}`;
    expect(
      reasonForStandard({
        message: "hi",
        recipient: RECIPIENT,
        nonce: NONCE_B64,
        signature: base58Signature,
        publicKey: PUBLIC_KEY,
      }),
    ).toBe("bad_signature_encoding");
  });

  it("treats a missing callbackUrl and an empty one as different messages", () => {
    // `option<string>` is present-or-absent in Borsh, so a client that blanks the field cannot
    // replay a signature made with a callback. An empty string is not even a payload we can rebuild.
    expect(reasonForStandard({ ...signedStandard({}), callbackUrl: "" })).toBe("malformed_payload");
    expect(
      reasonForStandard({
        ...signedStandard({ callbackUrl: "https://settle.app/done" }),
        callbackUrl: undefined,
      }),
    ).toBe("signature_mismatch");
  });

  it("rejects a nonce that is not exactly 32 bytes", () => {
    const short = Buffer.from(new Uint8Array(31).fill(7)).toString("base64");
    const long = Buffer.from(new Uint8Array(33).fill(7)).toString("base64");
    expect(reasonForStandard({ ...signedStandard({}), nonce: short })).toBe("nonce_too_short");
    // 33 bytes cannot be written into `[u8; 32]`, so there is no payload to verify at all.
    expect(reasonForStandard({ ...signedStandard({}), nonce: long })).toBe("malformed_payload");
  });

  it("rejects the wrong recipient, a spent nonce, and a freshness demand it cannot answer", () => {
    const signed = signedStandard({});
    expect(reasonForStandard(signed, { expectedRecipient: "other.app" })).toBe(
      "recipient_mismatch",
    );
    expect(
      reasonForStandard(signed, {
        expectedNonce: Buffer.from(new Uint8Array(32).fill(9)).toString("base64"),
      }),
    ).toBe("nonce_mismatch");
    expect(reasonForStandard(signed, { maxAgeMs: 60_000 })).toBe("stale");
  });

  it("rejects junk before touching the curve", () => {
    expect(reasonForStandard(null)).toBe("malformed_payload");
    expect(reasonForStandard({ ...signedStandard({}), publicKey: "secp256k1:abc" })).toBe(
      "malformed_payload",
    );
    expect(reasonForStandard({ ...signedStandard({}), publicKey: "ed25519:!!!" })).toBe(
      "bad_public_key",
    );
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
