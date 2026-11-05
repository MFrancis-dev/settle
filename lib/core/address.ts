/**
 * Per-chain address validation for payout and refund addresses.
 * Roadmap: S1.4 · Spec: ARCHITECTURE.md §11 S-B2
 *
 * A typo here is permanent loss, so an address is only accepted when this module can prove
 * its shape. Chains we cannot check are rejected rather than waved through — the caller then
 * names the chain to the user instead of silently trusting a paste.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";

/** Chains the MVP pays out to, from the asset table in ARCHITECTURE.md §3.2. */
export const SUPPORTED_CHAINS = ["near", "ethereum", "base", "arbitrum", "solana"] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export type AddressValidation =
  { readonly valid: true } | { readonly valid: false; readonly reason: string };

function invalid(reason: string): AddressValidation {
  return { valid: false, reason };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * NEAR account ids (https://docs.near.org/build/accounts/legacy-account-id-format): 2–64
 * characters of lowercase letters, digits and `-`, `_`, `.`; no leading or trailing `-` or
 * `.`; no empty label. 64-hex implicit accounts pass on length alone. 🔍 Re-check against
 * `near-api-js`'s validator when the NEAR sign-in task lands (S2.5).
 */
export function validateNearAccount(address: string): AddressValidation {
  if (address.length < 2 || address.length > 64) {
    return invalid("A NEAR account id is 2 to 64 characters");
  }
  if (!/^[a-z0-9_.-]+$/.test(address)) {
    return invalid("A NEAR account id uses lowercase letters, digits and - _ .");
  }
  if (address.startsWith(".") || address.endsWith(".")) {
    return invalid("A NEAR account id cannot start or end with a dot");
  }
  if (address.startsWith("-") || address.endsWith("-")) {
    return invalid("A NEAR account id cannot start or end with a hyphen");
  }
  if (address.includes("..")) {
    return invalid("A NEAR account id cannot have an empty label");
  }
  return { valid: true };
}

/**
 * EIP-55 mixed-case checksum. All-lower and all-upper are not checksummed, so they pass;
 * any mixed case must match the keccak digest exactly. `0x`-prefixed 40 hex digits only.
 */
export function validateEvmAddress(address: string): AddressValidation {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return invalid("An EVM address is 0x followed by 40 hex characters");
  }
  const body = address.slice(2);
  const lower = body.toLowerCase();
  const upper = body.toUpperCase();
  if (body === lower || body === upper) return { valid: true };

  // EIP-55 hashes the ASCII bytes of the lowercased hex digits, not the 20-byte address.
  const digest = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  const expected =
    "0x" +
    Array.from(body, (_, i) => {
      const nibble = Number.parseInt(digest[i] ?? "0", 16);
      return nibble >= 8 ? (upper[i] ?? "") : (lower[i] ?? "");
    }).join("");
  if (address !== expected) {
    return invalid("This EVM address fails its checksum — re-copy it from the wallet");
  }
  return { valid: true };
}

/** Solana addresses are the base58 encoding of exactly 32 bytes (Ed25519 public keys). */
export function validateSolanaAddress(address: string): AddressValidation {
  if (address.length < 32 || address.length > 44) {
    return invalid("A Solana address is 32 to 44 base58 characters");
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(address);
  } catch {
    return invalid("A Solana address is base58 — no 0, O, I or l");
  }
  if (bytes.length !== 32) {
    return invalid(`A Solana address decodes to 32 bytes, this decodes to ${bytes.length}`);
  }
  return { valid: true };
}

const VALIDATORS: Record<SupportedChain, (address: string) => AddressValidation> = {
  near: validateNearAccount,
  ethereum: validateEvmAddress,
  base: validateEvmAddress,
  arbitrum: validateEvmAddress,
  solana: validateSolanaAddress,
};

/**
 * Validate `address` against the rules for `chain`. An unrecognised chain is rejected: a
 * refund address we cannot check is worth a stuck payment, not a silent accept.
 */
export function validateAddress(chain: string, address: string): AddressValidation {
  const key = chain.toLowerCase();
  if (!isSupportedChain(key)) {
    return invalid(
      `No validator for chain "${chain}" yet — supported: ${SUPPORTED_CHAINS.join(", ")}`,
    );
  }
  return VALIDATORS[key](address);
}

export function isSupportedChain(chain: string): chain is SupportedChain {
  return (SUPPORTED_CHAINS as readonly string[]).includes(chain.toLowerCase());
}
