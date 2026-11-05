/**
 * Test-only helpers: sign a fixture quote so `verifyQuoteSignature()` has something real to check.
 *
 * The fixtures store a placeholder signature, because the point of a recorded fixture is the
 * payload shape. Signing happens here with a fixed throwaway key, which gives the suite both
 * halves S2.4 asks for: a signature the vendor's own verifier accepts, and a payload that fails
 * verification the moment any signed field is edited.
 *
 * 🔍 The manager public key built into the SDK
 * (`ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`) is the production value; tests never
 * use it, and it cannot be used to sign.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { quoteHash } from "@defuse-protocol/one-click-sdk-typescript";
import bs58 from "bs58";

import { quoteResponseSchema, type OneClickQuoteResponse } from "../quote";

/** Deterministic, disposable, and deliberately not a secret: only ever signs test fixtures. */
const TEST_SECRET = new Uint8Array(32).map((_, index) => index + 1);

export const TEST_MANAGER_PUBLIC_KEY = `ed25519:${bs58.encode(ed25519.getPublicKey(TEST_SECRET))}`;

export function signFixture(fixture: unknown): OneClickQuoteResponse {
  // Parsing through our own schema is what makes the enum-typed fields acceptable to the SDK's
  // `quoteHash()` without a cast, and it is the same boundary the live response goes through.
  const response = quoteResponseSchema.parse(structuredClone(fixture));
  const hash = quoteHash(response);
  const signature = ed25519.sign(new TextEncoder().encode(hash), TEST_SECRET);
  return { ...response, signature: `ed25519:${bs58.encode(signature)}` };
}

/** Change one signed field: the payload stays schema-valid, the signature stops matching. */
export function tamperAmountOut(response: OneClickQuoteResponse, amountOut: string) {
  return { ...response, quote: { ...response.quote, amountOut } };
}
