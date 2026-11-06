// @vitest-environment node
/**
 * The two signed request bodies, checked against the schema and the verifier the API actually uses.
 * Roadmap: S4.1, S4.2, S4.8 · Spec: ARCHITECTURE.md §5, §11
 *
 * `sign-in.test.ts` proves the bytes against the wallet library; this proves the *contract*: a body
 * built in the browser has to survive `signInInput`/`payoutInput` and then be accepted by
 * `verifyNep413SignedMessage`, which is what `POST /api/session` and `PUT /api/payout` run. Those two
 * halves were once green separately and incompatible together — the server expected a JSON `payload`
 * no wallet produces — so the pair is pinned here rather than assumed.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { serializeNep413 } from "@near-wallet-selector/core";

import { payoutMessage } from "@/lib/core/payout-message";
import { payoutInput, signInInput } from "@/lib/core/schemas";
import { verifyNep413SignedMessage } from "@/lib/near/nep413";

import { payoutBodyFromWallet } from "./payout-signature";
import { signInBodyFromWallet, type MessageSigner } from "./sign-in";

const SECRET = new Uint8Array(32).map((_, index) => index + 7);
const PUBLIC_KEY = `ed25519:${bs58.encode(ed25519.getPublicKey(SECRET))}`;
const RECIPIENT = "settle.test";
const ACCOUNT_ID = "ada.test-account";
const DESTINATION = { assetId: "near", chain: "near", address: "alice.testnet" };

/** Signs the standard payload with a real key, exactly as a wallet would. */
const wallet: MessageSigner = {
  async signMessage({ message, recipient, nonce }) {
    const payload = new Uint8Array(serializeNep413({ message, recipient, nonce }));
    const digest = createHash("sha256").update(payload).digest();
    return {
      accountId: ACCOUNT_ID,
      publicKey: PUBLIC_KEY,
      signature: Buffer.from(ed25519.sign(new Uint8Array(digest), SECRET)).toString("base64"),
    };
  },
};

describe("the sign-in body the API receives", () => {
  it("passes the route's schema and the route's verifier", async () => {
    const body = await signInBodyFromWallet({ signer: wallet, recipient: RECIPIENT });

    const parsed = signInInput.parse(body);
    expect(parsed.accountId).toBe(ACCOUNT_ID);

    const result = verifyNep413SignedMessage(parsed, {
      expectedRecipient: RECIPIENT,
      accountPublicKeys: [PUBLIC_KEY],
    });
    expect(result.valid).toBe(true);
  });

  it("is refused when the recipient the wallet signed is not this app", async () => {
    const body = await signInBodyFromWallet({ signer: wallet, recipient: RECIPIENT });

    const result = verifyNep413SignedMessage(signInInput.parse(body), {
      expectedRecipient: "another-app.test",
      accountPublicKeys: [PUBLIC_KEY],
    });
    expect(result).toEqual({ valid: false, reason: "recipient_mismatch" });
  });

  it("is refused when the signing key is not one the account owns", async () => {
    const body = await signInBodyFromWallet({ signer: wallet, recipient: RECIPIENT });
    const stranger = `ed25519:${bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(4)))}`;

    const result = verifyNep413SignedMessage(signInInput.parse(body), {
      expectedRecipient: RECIPIENT,
      accountPublicKeys: [stranger],
    });
    expect(result.valid).toBe(false);
  });
});

describe("the payout body the API receives", () => {
  it("passes the route's schema and the route's verifier", async () => {
    const body = await payoutBodyFromWallet({
      signer: wallet,
      recipient: RECIPIENT,
      destination: DESTINATION,
    });

    const parsed = payoutInput.parse(body);
    expect(parsed.address).toBe(DESTINATION.address);

    const result = verifyNep413SignedMessage(parsed, {
      expectedRecipient: RECIPIENT,
      accountPublicKeys: [PUBLIC_KEY],
    });
    expect(result.valid).toBe(true);
  });

  it("cannot be re-used for a different address, because the address is what was signed", async () => {
    const body = await payoutBodyFromWallet({
      signer: wallet,
      recipient: RECIPIENT,
      destination: DESTINATION,
    });
    const swapped = { ...body, address: "mallory.testnet", addressConfirm: "mallory.testnet" };

    // The signature itself is still a valid signature — over the *old* message. What catches the swap
    // is the comparison `lib/server/payout.ts` makes: the message must be `payoutMessage(chain,
    // address)` for the address the request is setting, so an edited address no longer matches.
    expect(payoutInput.parse(swapped).message).toBe(body.message);
    expect(payoutMessage(swapped.chain, swapped.address)).not.toBe(swapped.message);
    expect(payoutMessage(body.chain, body.address)).toBe(body.message);
  });
});
