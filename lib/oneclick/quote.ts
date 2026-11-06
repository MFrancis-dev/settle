/**
 * Build an `EXACT_OUTPUT` quote, dry and real, and verify the service signature.
 * Roadmap: S2.2 · Spec: ARCHITECTURE.md §3.2
 *
 * `EXACT_OUTPUT` is what makes Settle's promise work: the freelancer's payout amount is fixed
 * and the client's deposit absorbs slippage, so the invoice total is exactly what arrives.
 * The response's `amountIn` already contains the slippage buffer; anything above the true need
 * is refunded to `refundTo` after the swap (documented in the installed SDK's `QuoteRequest`).
 *
 * A real quote's `depositAddress` is only ever returned after `verifyQuoteSignature()` passes:
 * the signature is the service's attestation that the address belongs to *this* amount, asset
 * and recipient, so an unverified address is an unresolved funds-loss risk (AGENTS.md §6).
 */

import {
  QuoteRequest,
  verifyQuoteSignature as sdkVerifyQuoteSignature,
  type QuoteRequest as SdkQuoteRequest,
} from "@defuse-protocol/one-click-sdk-typescript";
import { z } from "zod";

import type { BaseUnits, QuoteSummary } from "../core/types";
import { fromBaseUnits, parseBaseUnits, toBaseUnits } from "../core/money";
import { OneClickError, type OneClickClient } from "./client";

/** Settle quotes with a fixed 1% input buffer (SD-4 era decision, ARCHITECTURE.md §3.2). */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** USD estimates are display-only (AGENTS.md §6); 8 places is far more than a cent needs. */
const USD_SCALE = 8;

/** `nativeEnum` keeps the parsed value assignable to the SDK types, so no cast is needed. */
const quoteRequestSchema = z
  .object({
    dry: z.boolean(),
    swapType: z.nativeEnum(QuoteRequest.swapType),
    slippageTolerance: z.number().int().min(0).max(10_000),
    originAsset: z.string().min(1),
    destinationAsset: z.string().min(1),
    amount: z.string().regex(/^\d+$/),
    refundTo: z.string().min(1),
    refundType: z.nativeEnum(QuoteRequest.refundType),
    depositType: z.nativeEnum(QuoteRequest.depositType),
    recipient: z.string().min(1),
    recipientType: z.nativeEnum(QuoteRequest.recipientType),
    deadline: z.string().min(1),
  })
  .passthrough();

/** A plain decimal string. Rejecting `$`/grouping here means `usdDifference` can never throw. */
const usdString = z.string().regex(/^\d+(?:\.\d+)?$/);

const quoteSchema = z
  .object({
    amountIn: z.string().regex(/^\d+$/),
    amountInFormatted: z.string(),
    amountInUsd: usdString,
    minAmountIn: z.string().regex(/^\d+$/),
    amountOut: z.string().regex(/^\d+$/),
    amountOutFormatted: z.string(),
    amountOutUsd: usdString,
    minAmountOut: z.string().regex(/^\d+$/),
    timeEstimate: z.number().nonnegative(),
    depositAddress: z.string().optional(),
    depositMemo: z.string().optional(),
    deadline: z.string().optional(),
    timeWhenInactive: z.string().optional(),
    refundFee: z.string().optional(),
    withdrawFee: z.string().optional(),
  })
  .passthrough();

export const quoteResponseSchema = z
  .object({
    correlationId: z.string(),
    /** Used by the service to derive the deposit address; part of the signed payload. */
    timestamp: z.string(),
    signature: z.string().min(1),
    quoteRequest: quoteRequestSchema,
    quote: quoteSchema,
  })
  .passthrough();

export type OneClickQuoteResponse = z.infer<typeof quoteResponseSchema>;

/** Thrown when a quote's signature does not check out; the deposit address is never returned. */
export class QuoteSignatureError extends Error {
  constructor(
    readonly correlationId: string,
    detail: string,
  ) {
    super(`1Click quote signature rejected (${correlationId}): ${detail}`);
    this.name = "QuoteSignatureError";
  }
}

export interface InvoiceQuoteParams {
  /** What the client pays in: a 1Click asset id resolved from `/v0/tokens`. */
  originAsset: string;
  /** Where a short or excess deposit goes back to: the client's own address. */
  refundTo: string;
  /** The freelancer's payout asset id. */
  destinationAsset: string;
  /** The freelancer's validated payout address. */
  recipient: string;
  /** Invoice total in payout-asset base units — the fixed side of the quote. */
  amountOut: BaseUnits;
  /** ISO timestamp after which 1Click begins refunding. */
  deadline: string;
  slippageBps?: number;
}

export function buildInvoiceQuoteRequest(
  params: InvoiceQuoteParams,
  opts: { dry: boolean },
): SdkQuoteRequest {
  return {
    dry: opts.dry,
    swapType: QuoteRequest.swapType.EXACT_OUTPUT,
    slippageTolerance: params.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: params.originAsset,
    depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
    destinationAsset: params.destinationAsset,
    amount: params.amountOut,
    refundTo: params.refundTo,
    refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
    recipient: params.recipient,
    recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
    deadline: params.deadline,
  };
}

/**
 * The vendor's own ed25519 check over the canonical quote hash. `managerPublicKey` defaults to
 * the key built into the SDK; pass the configured one to survive a key rotation.
 */
export function verifyQuoteSignature(
  response: OneClickQuoteResponse,
  managerPublicKey?: string,
): boolean {
  return sdkVerifyQuoteSignature(response, managerPublicKey);
}

/**
 * `amountInUsd − amountOutUsd`, the honest "what paying costs me" number, or `null` if negative.
 * Exported because the demo transport reports a fee the same way (`lib/oneclick/demo.ts`): one
 * implementation of a money rule, whether the numbers came from the service or from the recording.
 */
export function usdDifference(amountInUsd: string, amountOutUsd: string): string | null {
  const difference =
    BigInt(toBaseUnits(amountInUsd, USD_SCALE)) - BigInt(toBaseUnits(amountOutUsd, USD_SCALE));
  if (difference <= 0n) return null;
  return fromBaseUnits(parseBaseUnits(difference.toString()), USD_SCALE);
}

export interface RequestQuoteOptions {
  dry: boolean;
  managerPublicKey?: string;
}

/**
 * Ask 1Click for a quote and turn it into what Settle stores and shows.
 *
 * Dry quotes are previews and are never persisted; a real quote without a deposit address, or
 * with a signature that does not verify, throws instead of returning a partial summary.
 * A `minimumBaseUnits` on the thrown `OneClickError` means 1Click rejected the amount as too
 * small for that route — there is no published minimums table, so that number is the answer.
 */
export async function requestInvoiceQuote(
  client: OneClickClient,
  params: InvoiceQuoteParams,
  opts: RequestQuoteOptions,
): Promise<QuoteSummary> {
  const response = await client.requestJson(quoteResponseSchema, {
    method: "POST",
    path: "/v0/quote",
    body: buildInvoiceQuoteRequest(params, { dry: opts.dry }),
  });

  const hasAddress = response.quote.depositAddress !== undefined;
  const verified = verifyQuoteSignature(response, opts.managerPublicKey);

  if (!verified) {
    throw new QuoteSignatureError(
      response.correlationId,
      hasAddress ? "signature does not match the quote" : "no valid signature on preview quote",
    );
  }

  if (!opts.dry && !hasAddress) {
    throw new OneClickError(
      "malformed_response",
      200,
      response,
      "a non-dry quote must carry a depositAddress",
    );
  }

  return {
    dry: opts.dry,
    depositAddress: response.quote.depositAddress ?? null,
    depositMemo: response.quote.depositMemo ?? null,
    amountIn: parseBaseUnits(response.quote.amountIn),
    amountOut: parseBaseUnits(response.quote.amountOut),
    feeUsd: usdDifference(response.quote.amountInUsd, response.quote.amountOutUsd),
    deadline: response.quote.deadline ?? params.deadline,
    timeEstimateS: response.quote.timeEstimate,
    signature: response.signature,
    raw: response,
  };
}
