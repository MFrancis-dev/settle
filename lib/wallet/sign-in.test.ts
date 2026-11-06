// @vitest-environment node
/**
 * The client's NEP-413 sign-in body, checked against the wallet library's own verifier.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5
 *
 * The fake wallet signs with `@noble/curves` over the bytes the library's `serializeNep413` produces,
 * which is what a real wallet does. The oracle is the library's `verifySignature`, not Settle's code:
 * if the body lost or re-encoded any signed field, verification fails here rather than in production.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { serializeNep413, verifySignature } from "@near-wallet-selector/core";

import {
  NONCE_BYTES,
  createNonceBytes,
  signInBodyFromWallet,
  signInMessage,
  type MessageSigner,
} from "./sign-in";

/** Deterministic and disposable: only ever signs test messages, never funds. */
const SECRET = new Uint8Array(32).map((_, index) => index + 1);
const PUBLIC_KEY = `ed25519:${bs58.encode(ed25519.getPublicKey(SECRET))}`;
const RECIPIENT = "settle.test";
const ACCOUNT_ID = "ada.test-account";

/** A wallet that signs the standard payload instead of opening a dialog. */
function fakeWallet(opts: { echoState?: string } = {}): MessageSigner {
  return {
    async signMessage({ message, recipient, nonce }) {
      const payload = new Uint8Array(serializeNep413({ message, recipient, nonce }));
      const digest = ed25519.sign(nep413Digest(payload), SECRET);
      return {
        accountId: ACCOUNT_ID,
        publicKey: PUBLIC_KEY,
        signature: Buffer.from(digest).toString("base64"),
        ...(opts.echoState === undefined ? {} : { state: opts.echoState }),
      };
    },
  };
}

/** NEP-413 signs the sha256 of the Borsh payload, which has to exist before the signature does. */
function nep413Digest(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

describe("signInMessage", () => {
  it("names the app and the host the signature is bound to", () => {
    expect(signInMessage(RECIPIENT)).toBe(`Settle sign-in for ${RECIPIENT}`);
  });
});

describe("createNonceBytes", () => {
  it("asks the injected source for exactly 32 bytes", () => {
    let requested = 0;
    const bytes = createNonceBytes((target) => {
      requested = target.length;
      return target.fill(3);
    });
    expect(requested).toBe(NONCE_BYTES);
    expect(bytes).toEqual(new Uint8Array(NONCE_BYTES).fill(3));
  });

  it("defaults to the platform CSPRNG", () => {
    expect(createNonceBytes()).toHaveLength(NONCE_BYTES);
  });
});

describe("signInBodyFromWallet", () => {
  it("produces a body the wallet library verifies", async () => {
    const body = await signInBodyFromWallet({
      signer: fakeWallet(),
      recipient: RECIPIENT,
      random: (target) => target.fill(9),
    });

    expect(body.accountId).toBe(ACCOUNT_ID);
    expect(body.publicKey).toBe(PUBLIC_KEY);
    expect(body.nonce).toBe(Buffer.alloc(NONCE_BYTES, 9).toString("base64"));

    const verified = await verifySignature({
      publicKey: body.publicKey,
      signature: body.signature,
      message: body.message,
      nonce: Buffer.from(body.nonce, "base64"),
      recipient: body.recipient,
    });
    expect(verified).toBe(true);
  });

  it("fails verification if any signed field is swapped afterwards", async () => {
    const body = await signInBodyFromWallet({ signer: fakeWallet(), recipient: RECIPIENT });
    const tamperers: Record<string, () => Parameters<typeof verifySignature>[0]> = {
      message: () => ({ ...base(), message: "Settle sign-in for evil.test" }),
      recipient: () => ({ ...base(), recipient: "evil.test" }),
      nonce: () => ({ ...base(), nonce: Buffer.alloc(NONCE_BYTES, 11) }),
    };
    function base() {
      return {
        publicKey: body.publicKey,
        signature: body.signature,
        message: body.message,
        nonce: Buffer.from(body.nonce, "base64"),
        recipient: body.recipient,
      };
    }

    for (const [field, tamper] of Object.entries(tamperers)) {
      expect(await verifySignature(tamper()), `tampered ${field}`).toBe(false);
    }
  });

  it("carries the wallet's state only when it echoed one", async () => {
    const silent = await signInBodyFromWallet({ signer: fakeWallet(), recipient: RECIPIENT });
    expect("state" in silent).toBe(false);

    const echoed = await signInBodyFromWallet({
      signer: fakeWallet({ echoState: "return-to-invoices" }),
      recipient: RECIPIENT,
    });
    expect(echoed.state).toBe("return-to-invoices");
  });

  it("says so plainly when the wallet returns nothing", async () => {
    const silent: MessageSigner = {
      async signMessage() {
        return undefined;
      },
    };
    await expect(signInBodyFromWallet({ signer: silent, recipient: RECIPIENT })).rejects.toThrow(
      "The wallet did not return a signed message.",
    );
  });
});
