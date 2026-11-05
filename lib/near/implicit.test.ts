import { describe, expect, it } from "vitest";

import bs58 from "bs58";
import { implicitAccountFromPublicKey, isImplicitAccount } from "./implicit";
import { validateNearAccount } from "../core/address";

// Roadmap: S0.10 · the derivation rule is the one in NEAR's own docs, so the vector below is quoted
// from https://docs.near.org/protocol/accounts-contracts/account-id rather than generated here.
const DOCS_PUBLIC_KEY = "ed25519:BGCCDDHfysuuVnaNVtEhhqeT4k9Muyem3Kpgq2U1m9HX";
const DOCS_IMPLICIT_ACCOUNT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

describe("implicit account ids", () => {
  it("derives the address the docs derive from the same key", () => {
    expect(implicitAccountFromPublicKey(DOCS_PUBLIC_KEY)).toBe(DOCS_IMPLICIT_ACCOUNT);
  });

  it("is the hex of the 32 public key bytes, with or without the ed25519 prefix", () => {
    const bare = DOCS_PUBLIC_KEY.slice("ed25519:".length);
    const expected = Array.from(bs58.decode(bare), (b) => b.toString(16).padStart(2, "0")).join("");

    expect(implicitAccountFromPublicKey(bare)).toBe(expected);
    expect(implicitAccountFromPublicKey(bare)).toBe(implicitAccountFromPublicKey(DOCS_PUBLIC_KEY));
  });

  it("produces an account id the payout validator accepts", () => {
    expect(validateNearAccount(DOCS_IMPLICIT_ACCOUNT).valid).toBe(true);
    expect(isImplicitAccount(DOCS_IMPLICIT_ACCOUNT)).toBe(true);
    expect(isImplicitAccount("alice.test")).toBe(false);
    // Upper case is not how NEAR writes these, and the chain would not resolve it.
    expect(isImplicitAccount(DOCS_IMPLICIT_ACCOUNT.toUpperCase())).toBe(false);
  });

  it("refuses anything that is not an ed25519 key instead of returning a guess", () => {
    expect(() => implicitAccountFromPublicKey("not base58 0OIl")).toThrow(/base58/);
    // A short key would otherwise yield a 62-character address that looks like an implicit account.
    expect(() => implicitAccountFromPublicKey(bs58.encode(new Uint8Array(31)))).toThrow(/31 bytes/);
    expect(() =>
      implicitAccountFromPublicKey("secp256k1:4Rs4pkEicEqEHJNrUWZbD517GCJlpjGTr6ss8m2pQ1gN"),
    ).toThrow();
  });
});
