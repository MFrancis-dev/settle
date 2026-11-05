import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bs58 from "bs58";

// Roadmap: S3.8
import type { SignedMessageFields } from "../core/schemas";
import { HttpError } from "./http";
import { checkSignedMessage, requireSigned, verifySigned } from "./signature";
import { createRouteHarness, signClaims, type RouteHarness, type Signer } from "./__fixtures__/routes";

let harness: RouteHarness;
let signer: Signer;

beforeAll(async () => {
  harness = await createRouteHarness();
  signer = harness.newSigner();
});

afterAll(async () => {
  await harness?.close();
});

function signed(overrides: Partial<SignedMessageFields> = {}): SignedMessageFields {
  return { ...signClaims(signer, { message: "Settle sign-in" }), ...overrides };
}

describe("signed message checks", () => {
  it("accepts a signature from a key the account owns", async () => {
    const result = await checkSignedMessage(harness.deps, signed(), { accountId: signer.accountId });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.claims.message).toBe("Settle sign-in");
  });

  it("reports why a signature from a key the account does not own fails", async () => {
    const stranger = harness.foreignSigner();
    const result = await checkSignedMessage(harness.deps, signClaims(stranger, { message: "hi" }), {
      accountId: stranger.accountId,
    });

    // The same reason as a wrong signature: telling them apart would map which keys an account holds.
    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("refuses a message addressed to another site", async () => {
    const result = await checkSignedMessage(
      harness.deps,
      signClaims(signer, { message: "Settle sign-in", recipient: "evil.example" }),
      { accountId: signer.accountId },
    );

    expect(result).toEqual({ valid: false, reason: "recipient_mismatch" });
  });

  it("refuses to spend the same nonce twice", async () => {
    const body = signClaims(signer, { message: "Settle sign-in" });
    const first = await checkSignedMessage(harness.deps, body, { accountId: signer.accountId });
    const second = await checkSignedMessage(harness.deps, body, { accountId: signer.accountId });

    expect(first.valid).toBe(true);
    expect(second).toEqual({ valid: false, reason: "replayed" });
  });

  it("requires the signed text to quote what the request asks for", async () => {
    const body = signClaims(signer, { message: "Settle payout change to old.near on near" });

    const result = await verifySigned(harness.deps, body, {
      accountId: signer.accountId,
      expectedMessage: "Settle payout change to new.near on near",
    });

    expect(result).toEqual({ valid: false, reason: "message_mismatch" });
  });

  it("accepts the message when it matches exactly", async () => {
    const result = await verifySigned(
      harness.deps,
      signClaims(signer, { message: "Settle payout change to new.near on near" }),
      { accountId: signer.accountId, expectedMessage: "Settle payout change to new.near on near" },
    );

    expect(result.valid).toBe(true);
  });

  it("rejects a payload that is not JSON", async () => {
    const result = await checkSignedMessage(harness.deps, signed({ payload: "i am not json" }), {
      accountId: signer.accountId,
    });

    expect(result).toEqual({ valid: false, reason: "malformed_payload" });
  });

  it("rejects a body that is missing the signed trio", async () => {
    expect(
      await checkSignedMessage(harness.deps, { accountId: signer.accountId }, { accountId: signer.accountId }),
    ).toEqual({
      valid: false,
      reason: "malformed_payload",
    });
  });

  it("rejects a public key that is not ed25519 base58", async () => {
    const result = await checkSignedMessage(harness.deps, signed({ publicKey: "ed25519:!!!!" }), {
      accountId: signer.accountId,
    });

    expect(result).toEqual({ valid: false, reason: "bad_public_key" });
  });

  it("rejects a signature of the wrong length", async () => {
    const result = await checkSignedMessage(
      harness.deps,
      signed({ signature: `ed25519:${bs58.encode(new Uint8Array(8))}` }),
      { accountId: signer.accountId },
    );

    expect(result).toEqual({ valid: false, reason: "bad_signature_encoding" });
  });

  it("rejects a signature made by a different key over the same bytes", async () => {
    const other = harness.newSigner();
    const result = await checkSignedMessage(
      harness.deps,
      signed({ signature: `ed25519:${bs58.encode(new Uint8Array(64).fill(7))}` }),
      { accountId: other.accountId },
    );

    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects a nonce shorter than 32 bytes", async () => {
    const shortNonce = Buffer.from(new Uint8Array(8)).toString("base64");
    const result = await checkSignedMessage(
      harness.deps,
      signClaims(signer, { message: "Settle sign-in", nonce: shortNonce }),
      { accountId: signer.accountId },
    );

    expect(result).toEqual({ valid: false, reason: "nonce_too_short" });
  });

  it("ignores the extra fields a route body carries", async () => {
    const body = { ...signed(), accountId: signer.accountId, address: "someone.near" };
    const result = await checkSignedMessage(harness.deps, body, { accountId: signer.accountId });

    expect(result.valid).toBe(true);
  });

  it("throws a 401 with the reason when a check is required", async () => {
    const body = signClaims(signer, { message: "Settle sign-in", recipient: "evil.example" });

    await expect(requireSigned(harness.deps, body, { accountId: signer.accountId })).rejects.toThrowError(
      HttpError,
    );

    const error = (await requireSigned(harness.deps, body, { accountId: signer.accountId }).catch(
      (thrown: unknown) => thrown,
    )) as HttpError;
    expect(error.status).toBe(401);
    expect(error.details).toEqual({ reason: "recipient_mismatch" });
    expect(error.message).toContain("recipient_mismatch");
  });


});
