import { describe, expect, it } from "vitest";

// Roadmap: S1.4
import {
  SUPPORTED_CHAINS,
  isMemoChain,
  isSupportedChain,
  unsupportedRefundReason,
  validateAddress,
  validateEvmAddress,
  validateNearAccount,
  validateSolanaAddress,
} from "./address";

/** The four checksummed examples from EIP-55 itself. */
const EIP55 = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xFb6916053F65C16F831Be83850bE52ccB15729c9",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];

/** The stablecoin contracts from ARCHITECTURE.md §3.2, in their checksummed form. */
const USDC_ETHEREUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDT_ETHEREUM = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

describe("address: NEAR account ids", () => {
  it("accepts human, named-tld and implicit accounts", () => {
    for (const ok of [
      "alice.testnet",
      "bob.near",
      "mike",
      "a-b",
      "a_b",
      "s1.test-net",
      "f".repeat(64),
    ]) {
      expect(validateNearAccount(ok), ok).toEqual({ valid: true });
    }
  });

  it("rejects the typos that would burn funds", () => {
    const tooLong = "a".repeat(65);
    for (const bad of [
      "a",
      "",
      "A.near",
      "Alice.near",
      "a b",
      "a@b",
      "a..b",
      ".a",
      "a.",
      "-a",
      "a-",
      tooLong,
    ]) {
      const result = validateNearAccount(bad);
      expect(result.valid, bad).toBe(false);
      if (!result.valid) expect(result.reason.length, bad).toBeGreaterThan(0);
    }
  });
});

describe("address: EVM", () => {
  it("accepts every EIP-55 checksum, all-lower and all-upper", () => {
    for (const address of [...EIP55, USDC_ETHEREUM, USDC_BASE, USDC_ARBITRUM, USDT_ETHEREUM]) {
      expect(validateEvmAddress(address), address).toEqual({ valid: true });
      expect(validateEvmAddress(address.toLowerCase()), address).toEqual({ valid: true });
      expect(validateEvmAddress(`0x${address.slice(2).toUpperCase()}`), address).toEqual({
        valid: true,
      });
    }
  });

  it("rejects a bad checksum — mixed case that is not the digest", () => {
    for (const bad of [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd",
      "0xdAC17F958D2ee523a2206206994597c13D831ec7",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6fb",
    ]) {
      const result = validateEvmAddress(bad);
      expect(result.valid, bad).toBe(false);
    }
  });

  it("rejects a malformed address", () => {
    for (const bad of [
      "",
      "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeddd",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeg",
      "0x0",
    ]) {
      expect(validateEvmAddress(bad).valid, bad).toBe(false);
    }
  });
});

describe("address: Solana", () => {
  it("accepts a base58 public key that decodes to 32 bytes", () => {
    for (const ok of [
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ]) {
      expect(validateSolanaAddress(ok), ok).toEqual({ valid: true });
    }
  });

  it("rejects non-base58 characters and wrong-length keys", () => {
    for (const bad of [
      "So1111111111111111111111111111111111111111O", // letter O
      "So1111111111111111111111111111111111111111l", // lower-case L
      "thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE", // decodes to 31 bytes
      "JNArUumxYJcSQpbuxuroRZtcSMVLcy5WbYGt14SRm1Fv", // decodes to 33 bytes
      "0OIl",
      "",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    ]) {
      const result = validateSolanaAddress(bad);
      expect(result.valid, bad).toBe(false);
      if (!result.valid) expect(result.reason.length, bad).toBeGreaterThan(0);
    }
  });
});

describe("address: validateAddress by chain", () => {
  const GOOD: Record<string, string> = {
    near: "alice.testnet",
    ethereum: USDC_ETHEREUM,
    base: USDC_BASE,
    arbitrum: USDC_ARBITRUM,
    solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  };

  it("accepts a valid address on every supported chain", () => {
    expect(Object.keys(GOOD).sort()).toEqual([...SUPPORTED_CHAINS].sort());
    for (const [chain, address] of Object.entries(GOOD)) {
      expect(validateAddress(chain, address).valid, chain).toBe(true);
    }
  });

  it("ignores the case of the chain name", () => {
    expect(validateAddress("NEAR", "alice.testnet").valid).toBe(true);
    expect(validateAddress("Solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").valid).toBe(
      true,
    );
  });

  it("rejects a valid address on the wrong chain", () => {
    expect(validateAddress("solana", "alice.testnet").valid).toBe(false);
    expect(validateAddress("near", EIP55[0] ?? "").valid).toBe(false);
    expect(validateAddress("base", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").valid).toBe(
      false,
    );
  });

  it("rejects a chain with no validator rather than waving it through", () => {
    for (const chain of ["bitcoin", "ton", "tron", "", "eth"]) {
      const result = validateAddress(chain, "whatever");
      expect(result.valid, chain).toBe(false);
      if (!result.valid) expect(result.reason, chain).toContain("supported:");
    }
  });

  it("knows which chains it supports", () => {
    expect(isSupportedChain("base")).toBe(true);
    expect(isSupportedChain("BASE")).toBe(true);
    expect(isSupportedChain("bitcoin")).toBe(false);
  });
});

describe("address: the reason a chain cannot hold a refund (S7.5)", () => {
  it("says nothing about a chain it can validate", () => {
    for (const chain of SUPPORTED_CHAINS) expect(unsupportedRefundReason(chain)).toBeNull();
  });

  it("names the memo, because that is the part that loses the money", () => {
    const reason = unsupportedRefundReason("xrpl");

    expect(reason).toContain("memo or destination tag");
    expect(reason).toContain("not recoverable");
    expect(reason).toContain(SUPPORTED_CHAINS.join(", "));
  });

  it("says 'we cannot check it' for a chain that is merely unrecognised", () => {
    const reason = unsupportedRefundReason("tron");

    expect(reason).toContain("cannot check a refund address");
    expect(reason).not.toContain("memo");
  });

  it("reads 1Click's chain codes case-insensitively", () => {
    expect(isMemoChain("BTC")).toBe(true);
    expect(isMemoChain("stellar")).toBe(true);
    expect(isMemoChain("near")).toBe(false);
    expect(isMemoChain("sol")).toBe(false);
  });
});
