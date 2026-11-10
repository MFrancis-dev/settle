/**
 * Per-chain address validation for payout and refund addresses.
 * Roadmap: S1.4 · Spec: ARCHITECTURE.md §11 S-B2
 *
 * A typo here is permanent loss, so an address is only accepted when this module can prove
 * its shape. Chains we cannot check are rejected rather than waved through — the caller then
 * names the chain to the user instead of silently trusting a paste.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";

/** Chains the MVP pays out to, from the asset table in ARCHITECTURE.md §3.2. */
export const SUPPORTED_CHAINS = ["near", "ethereum", "base", "arbitrum", "solana"] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

/**
 * Chains Settle will *refund to* but never pays out on (S1.7, #100). A client can pay from a
 * token on Bitcoin, and a short or excess deposit goes back to an address there. Validating it is
 * the whole point: 1Click would accept the quote without us checking where the money returns.
 */
export const REFUND_ONLY_CHAINS = ["btc"] as const;
export type RefundOnlyChain = (typeof REFUND_ONLY_CHAINS)[number];
export type RefundChain = SupportedChain | RefundOnlyChain;
export const REFUND_CHAINS = [...SUPPORTED_CHAINS, ...REFUND_ONLY_CHAINS] as const;

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

/**
 * Bitcoin spends to script hashes, so the address encodes a witness program (bech32/bech32m) or a
 * base58-check hashed key. Both are checksummed, which is why this can be validated rather than
 * merely shape-checked; a single wrong character fails the checksum instead of sending funds to a
 * different script. Mainnet only — a testnet address would name a chain 1Click does not refund on.
 */
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;

function bech32Polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit += 1) {
      if (((top >>> bit) & 1) === 1) checksum ^= BECH32_GENERATOR[bit] ?? 0;
    }
  }
  return checksum >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31);
  return expanded;
}

/** 5-bit groups to 8-bit bytes, or null when padding is not canonical (BIP-173). */
function convertBits(
  words: readonly number[],
  from: number,
  to: number,
  pad: boolean,
): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const out: number[] = [];
  const maxValue = (1 << to) - 1;
  for (const word of words) {
    if (word < 0 || word >>> from !== 0) return null;
    accumulator = (accumulator << from) | word;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((accumulator >>> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits > 0) out.push((accumulator << (to - bits)) & maxValue);
  } else if (bits >= from || ((accumulator << (to - bits)) & maxValue) !== 0) {
    return null;
  }
  return out;
}

function validateBitcoinWitness(address: string): AddressValidation {
  if (address.length > 90) return invalid("A Bitcoin address is at most 90 characters");
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    return invalid("A Bitcoin address cannot mix upper and lower case");
  }
  const lower = address.toLowerCase();
  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length) {
    return invalid("This is not a complete bech32 Bitcoin address");
  }
  const hrp = lower.slice(0, separator);
  if (hrp !== "bc") {
    return invalid("A Bitcoin address starts with bc1 — this is not a mainnet address");
  }
  const words = [...lower.slice(separator + 1)].map((char) => BECH32_CHARSET.indexOf(char));
  if (words.some((word) => word === -1)) {
    return invalid("A bech32 address uses only the characters 023456789acdefghjklmnpqrstuvwxyz");
  }
  const constant = bech32Polymod([...bech32HrpExpand(hrp), ...words]);
  const version = words[0] ?? -1;
  if (version < 0 || version > 16) return invalid("A Bitcoin witness version is 0 to 16");

  if (version === 0) {
    if (constant !== BECH32_CONST) return invalid("This Bitcoin address fails its checksum");
    const program = convertBits(words.slice(1, -6), 5, 8, false);
    if (program === null || (program.length !== 20 && program.length !== 32)) {
      return invalid("A segwit version 0 address holds a 20- or 32-byte program");
    }
    return { valid: true };
  }
  if (constant !== BECH32M_CONST) return invalid("This Bitcoin address fails its checksum");
  const program = convertBits(words.slice(1, -6), 5, 8, false);
  if (program === null || program.length < 2 || program.length > 40) {
    return invalid("A taproot address holds a 2- to 40-byte program");
  }
  return { valid: true };
}

export function validateBitcoinAddress(address: string): AddressValidation {
  // Any segwit address is letters then the separator; `bc1` is mainnet, `tb1`/`bcrt1` are not.
  if (/^[a-z]{2,4}1[a-z0-9]+$/i.test(address)) return validateBitcoinWitness(address);

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(address);
  } catch {
    return invalid("A Bitcoin address starts with bc1, 1 or 3");
  }
  if (bytes.length !== 25) return invalid("A legacy Bitcoin address decodes to 25 bytes");
  const version = bytes[0] ?? -1;
  if (version === 0x6f || version === 0xc4) {
    return invalid("This is a testnet Bitcoin address — pay from a token on mainnet");
  }
  if (version !== 0x00 && version !== 0x05) {
    return invalid("A legacy Bitcoin address starts with 1 or 3");
  }
  const payload = bytes.subarray(0, 21);
  const checksum = bytes.subarray(21);
  const digest = sha256(sha256(payload)).subarray(0, 4);
  if (checksum.some((byte, index) => byte !== (digest[index] ?? -1))) {
    return invalid("This Bitcoin address fails its checksum — re-copy it from the wallet");
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

export function isRefundChain(chain: string): chain is RefundChain {
  return (REFUND_CHAINS as readonly string[]).includes(chain.toLowerCase());
}

/**
 * Validate a `refundTo` on the chain the client pays from. Wider than `validateAddress`: an origin
 * chain may be one Settle only refunds to (S1.7). A payout address is still checked by the narrower
 * function, so a chain added here can never become a place Settle sends the seller's money.
 */
export function validateRefundAddress(chain: string, address: string): AddressValidation {
  const key = chain.toLowerCase();
  if (key === "btc") return validateBitcoinAddress(address);
  return validateAddress(key, address);
}

/**
 * Networks where an address alone is not a destination: the refund also needs a memo, destination
 * tag or payment id, and one sent without it lands on an exchange's shared account and is gone
 * (S7.5). Settle has no memo field for a refund, so these are named rather than silently refused.
 *
 * Bitcoin was removed from this list with S1.7 (#100): a BTC refund address carries its own checksum
 * and needs no memo, so the earlier entry only mis-worded a refusal.
 *
 * 🔍 UNVERIFIED: 1Click does not publish which origins carry a memo requirement, so this list only
 * decides *how* a refusal is worded.
 */
export const MEMO_CHAIN_CODES = [
  "xrp",
  "xrpl",
  "xlm",
  "stellar",
  "ton",
  "atom",
  "cosmos",
  "eos",
  "bnb",
  "bnc",
] as const;

/** Whether 1Click's own short chain code (`xrpl`, `btc`, …) names a network that needs a memo. */
export function isMemoChain(blockchain: string): boolean {
  return (MEMO_CHAIN_CODES as readonly string[]).includes(blockchain.toLowerCase());
}

/**
 * Why a chain cannot hold a refund address, in the words a client can act on. Null when the chain
 * is one Settle validates, so callers never have to invent their own sentence.
 */
export function unsupportedRefundReason(blockchain: string): string | null {
  if (isRefundChain(blockchain)) return null;
  const supported = REFUND_CHAINS.join(", ");
  if (isMemoChain(blockchain)) {
    return `A refund on ${blockchain} needs a memo or destination tag that Settle cannot attach, and a refund sent without it is not recoverable. Pay from a token on ${supported} instead.`;
  }
  return `Settle cannot check a refund address on ${blockchain} yet, and an address it cannot check is not one it will send money back to. Pay from a token on ${supported} instead.`;
}
