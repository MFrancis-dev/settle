/**
 * The demo 1Click transport: the same endpoints, answered in process.
 * Roadmap: S6.1 · Spec: ARCHITECTURE.md §3.2, §7
 *
 * Demo mode substitutes the *transport*, not the client. `createDemoOneClickFetch()` returns a
 * `FetchLike`, so a demo quote travels through the same `createOneClickClient` → `requestInvoiceQuote`
 * → `verifyQuoteSignature()` path a real one does, and a demo deposit address is only ever handed to
 * the pay page after the vendor's own verifier accepted its signature. Nothing above this module
 * knows which mode it is in.
 *
 * Two rules this file exists to keep:
 * - a **non-dry quote is never forwarded**. Demo mode creates no real deposit address, because a real
 *   address is a real place somebody could send money;
 * - a dry quote **is** forwarded when the network is reachable (§7: real dry-run numbers in the demo),
 *   and falls back to a quote computed from the recorded token list when it is not.
 *
 * A forwarded dry quote is re-signed by the demo key before it is returned. The amounts stay the
 * vendor's; the signature cannot, because one manager key has to verify every quote in a demo
 * process and Settle does not hold the vendor's.
 *
 * Where the state lives: this transport is a *mirror*. `/v0/status` reports what the caller's `stage`
 * reader says about a deposit address — in the app that reader is the `payment_attempts` row — so the
 * worker's poll and the pay page's poll read back the state `simulate-payment` wrote and change
 * nothing. There is no second copy of a payment's progress to drift.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { quoteHash } from "@defuse-protocol/one-click-sdk-typescript";
import bs58 from "bs58";

import { fromBaseUnits, parseBaseUnits, roundHalfUp, toBaseUnits } from "../core/money";
import type { OneClickStatus } from "../core/status";
import type { QuoteSummary } from "../core/types";
import statusFixtures from "./__fixtures__/statuses.json";
import tokenFixtures from "./__fixtures__/tokens.json";
import type { FetchLike } from "./client";
import { quoteResponseSchema, usdDifference, type OneClickQuoteResponse } from "./quote";

/**
 * The demo service's signing key. Deterministic, published, and not a secret: it signs quotes that
 * move nothing, and demo mode pins it as the manager key so the vendor's verifier checks a demo quote
 * exactly as it checks a real one.
 */
const DEMO_SECRET = new Uint8Array(32).map((_, index) => (index * 11 + 5) % 256);

export const DEMO_MANAGER_PUBLIC_KEY = `ed25519:${bs58.encode(ed25519.getPublicKey(DEMO_SECRET))}`;

/** USD figures are display-only (AGENTS.md §6); 8 places is what the real API returns. */
const USD_SCALE = 8;

export interface DemoToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
}

/** The recorded `/v0/tokens` response: what the demo serves, and prices with, offline. */
export const DEMO_TOKENS: readonly DemoToken[] = tokenFixtures as readonly DemoToken[];

const STATUS_TEMPLATES = statusFixtures as Record<string, Record<string, unknown>>;

/** Sign a quote body with the demo key, through the same schema the live response is parsed with. */
export function signDemoQuote(body: unknown): OneClickQuoteResponse {
  const response = quoteResponseSchema.parse(body);
  const signature = ed25519.sign(new TextEncoder().encode(quoteHash(response)), DEMO_SECRET);
  return { ...response, signature: `ed25519:${bs58.encode(signature)}` };
}

/** A deterministic 44-character base58 hash: shaped like a real one, and visibly not one. */
export function demoTxHash(seed: string): string {
  return bs58.encode(sha256(new TextEncoder().encode(`settle-demo-tx:${seed}`)));
}

let addressSequence = 0;

/**
 * One deposit address per quote, ever — `payment_attempts.deposit_address` is unique for the life of
 * the payment. The quote's own fields plus the time plus a counter make a repeat impossible without
 * a shared counter that a restarted process would lose.
 */
export function demoDepositAddress(request: Record<string, unknown>, nowMs: number): string {
  addressSequence += 1;
  const seed = [
    request.originAsset,
    request.destinationAsset,
    request.amount,
    request.recipient,
    request.refundTo,
    nowMs,
    addressSequence,
  ].join("|");
  const digest = bs58.encode(sha256(new TextEncoder().encode(seed))).slice(0, 20);
  return `settle-demo-${digest}`;
}

/** A demo quote that cannot be built; answered as a 400 so the pay page says why. */
export class DemoQuoteError extends Error {
  constructor(detail: string) {
    super(`demo quote refused: ${detail}`);
    this.name = "DemoQuoteError";
  }
}

export interface DemoAmounts {
  /** What the client sends: the invoice total priced in the origin asset, plus the slippage buffer. */
  amountIn: string;
  amountInUsd: string;
  amountOutUsd: string;
}

function usdOf(baseUnits: string, decimals: number, price: number): bigint {
  const priceScaled = BigInt(toBaseUnits(String(price), USD_SCALE));
  return roundHalfUp(BigInt(baseUnits) * priceScaled, 10n ** BigInt(decimals));
}

function usdText(units: bigint): string {
  return fromBaseUnits(parseBaseUnits(units.toString()), USD_SCALE);
}

/**
 * Price an `EXACT_OUTPUT` demo quote from the token list's own `price` and `decimals`.
 *
 * The destination side is fixed — that is the whole point of `EXACT_OUTPUT` — so the deposit is the
 * invoice total converted at the recorded prices with the requested slippage tolerance on top. A
 * token the list prices at zero cannot be quoted from; that is reported rather than guessed at.
 */
export function demoAmounts(input: {
  amountOut: string;
  origin: DemoToken;
  destination: DemoToken;
  slippageTolerance: number;
}): DemoAmounts {
  if (input.origin.price <= 0 || input.destination.price <= 0) {
    throw new DemoQuoteError(
      `the demo token list has no price for ${
        input.origin.price <= 0 ? input.origin.assetId : input.destination.assetId
      }`,
    );
  }

  const amountOutUsd = usdOf(input.amountOut, input.destination.decimals, input.destination.price);
  const amountInUsd = roundHalfUp(amountOutUsd * BigInt(10_000 + input.slippageTolerance), 10_000n);
  const priceScaled = BigInt(toBaseUnits(String(input.origin.price), USD_SCALE));
  const amountIn = roundHalfUp(amountInUsd * 10n ** BigInt(input.origin.decimals), priceScaled);

  return {
    amountIn: amountIn.toString(),
    amountInUsd: usdText(amountInUsd),
    amountOutUsd: usdText(amountOutUsd),
  };
}

/** The quote request a Settle quote call carries, as the transport receives it. */
export interface DemoQuoteRequest {
  originAsset: string;
  destinationAsset: string;
  /** The fixed side: the invoice total, in destination base units. */
  amount: string;
  recipient: string;
  refundTo: string;
  deadline: string;
  slippageTolerance?: number;
  dry?: boolean;
}

/**
 * Build an unsigned demo quote body around a request.
 *
 * `EXACT_OUTPUT` and a 1 % default buffer are the same choices `buildInvoiceQuoteRequest` makes, so
 * the numbers a judge sees in the demo are the numbers the real service would be asked for.
 */
export function demoQuoteBody(
  request: DemoQuoteRequest,
  options: { tokens: readonly DemoToken[]; now(): number; depositAddress?: string },
): Record<string, unknown> {
  const find = (assetId: string): DemoToken => {
    const token = options.tokens.find((candidate) => candidate.assetId === assetId);
    if (!token) throw new DemoQuoteError(`${assetId} is not on the demo token list`);
    return token;
  };
  const origin = find(request.originAsset);
  const destination = find(request.destinationAsset);
  const dry = request.dry === true;
  const slippage = request.slippageTolerance ?? 100;

  const amounts = demoAmounts({
    amountOut: request.amount,
    origin,
    destination,
    slippageTolerance: slippage,
  });

  const quote: Record<string, unknown> = {
    amountIn: amounts.amountIn,
    amountInFormatted: amounts.amountIn,
    amountInUsd: amounts.amountInUsd,
    minAmountIn: amounts.amountIn,
    amountOut: request.amount,
    amountOutFormatted: request.amount,
    amountOutUsd: amounts.amountOutUsd,
    minAmountOut: request.amount,
    timeEstimate: 45,
    deadline: request.deadline,
  };
  if (!dry) {
    quote.depositAddress =
      options.depositAddress ??
      demoDepositAddress({ ...request, amount: request.amount }, options.now());
  }

  const nowMs = options.now();
  return {
    correlationId: `demo-quote-${nowMs.toString(36)}`,
    timestamp: new Date(nowMs).toISOString(),
    signature: "ed25519 UNSIGNED DEMO",
    quoteRequest: {
      dry,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: slippage,
      originAsset: request.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: request.destinationAsset,
      amount: request.amount,
      refundTo: request.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: request.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: request.deadline,
    },
    quote,
  };
}

/** A signed response as the `QuoteSummary` Settle stores — the same mapping `requestInvoiceQuote` does. */
export function toDemoQuoteSummary(response: OneClickQuoteResponse): QuoteSummary {
  return {
    dry: response.quoteRequest.dry,
    depositAddress: response.quote.depositAddress ?? null,
    depositMemo: response.quote.depositMemo ?? null,
    amountIn: parseBaseUnits(response.quote.amountIn),
    amountOut: parseBaseUnits(response.quote.amountOut),
    feeUsd: usdDifference(response.quote.amountInUsd, response.quote.amountOutUsd),
    deadline: response.quote.deadline ?? response.quoteRequest.deadline,
    timeEstimateS: response.quote.timeEstimate,
    signature: response.signature,
    raw: response,
  };
}

/**
 * A signed demo quote, for callers that need one without an HTTP round-trip: the seed writes attempts
 * that look exactly like the ones a live quote produces, receipt payload and signature included.
 */
export function buildDemoQuote(
  request: DemoQuoteRequest,
  options: { now(): number; tokens?: readonly DemoToken[]; depositAddress?: string },
): QuoteSummary {
  const tokens = options.tokens ?? DEMO_TOKENS;
  const body = demoQuoteBody(
    { ...request, dry: false },
    {
      tokens,
      now: options.now,
      ...(options.depositAddress ? { depositAddress: options.depositAddress } : {}),
    },
  );
  return toDemoQuoteSummary(signDemoQuote(body));
}

/** What the demo service reports for one deposit address, read from wherever the caller keeps it. */
export interface DemoStage {
  status: OneClickStatus;
  depositedAmount?: string | null;
  refundedAmount?: string | null;
  refundReason?: string | null;
  depositTxHash?: string | null;
  deliveryTxHash?: string | null;
  /** The quote this payment was created from, echoed back the way the real service echoes it. */
  quoteResponse?: unknown;
}

export interface DemoUpstream {
  fetch: FetchLike;
  baseUrl: string;
  jwt?: string;
}

export interface DemoOneClickOptions {
  /** `null` means the address is unknown to us, which the service answers as a 404. */
  stage(depositAddress: string): Promise<DemoStage | null>;
  now(): number;
  /** The real transport, used for dry quotes and the token list only. Absent means an offline demo. */
  upstream?: DemoUpstream;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound(message: string): Response {
  return jsonResponse({ message }, 404);
}

function explorerUrl(hash: string): string {
  return `https://explorer.near.org/transactions/${hash}`;
}

/** The recorded body for a status, with this payment's own figures and hashes in place. */
export function demoStatusBody(
  stage: DemoStage,
  input: { correlationId: string; nowMs: number },
): Record<string, unknown> {
  const template = STATUS_TEMPLATES[stage.status] ?? STATUS_TEMPLATES.PENDING_DEPOSIT;
  if (!template) throw new DemoQuoteError(`no recorded body for ${stage.status}`);
  const details = { ...(template.swapDetails as Record<string, unknown>) };

  details.originChainTxHashes = stage.depositTxHash
    ? [{ hash: stage.depositTxHash, explorerUrl: explorerUrl(stage.depositTxHash) }]
    : [];
  details.destinationChainTxHashes = stage.deliveryTxHash
    ? [{ hash: stage.deliveryTxHash, explorerUrl: explorerUrl(stage.deliveryTxHash) }]
    : [];
  details.intentHashes = [];
  details.nearTxHashes = stage.deliveryTxHash ? [stage.deliveryTxHash] : [];

  const figures: [string, string | null | undefined][] = [
    ["depositedAmount", stage.depositedAmount],
    ["refundedAmount", stage.refundedAmount],
    ["refundReason", stage.refundReason],
  ];
  for (const [key, value] of figures) {
    if (value === undefined || value === null) delete details[key];
    else details[key] = value;
  }
  // The formatted and USD echoes in the recording belong to the recorded payment, not to this one.
  for (const key of ["depositedAmountFormatted", "depositedAmountUsd", "refundedAmountFormatted"]) {
    delete details[key];
  }

  return {
    ...template,
    correlationId: input.correlationId,
    status: stage.status,
    updatedAt: new Date(input.nowMs).toISOString(),
    swapDetails: details,
    ...(stage.quoteResponse === undefined ? {} : { quoteResponse: stage.quoteResponse }),
  };
}

/**
 * Build the demo transport.
 *
 * The token list it prices from is whatever `/v0/tokens` last answered — the forwarded one when the
 * network is up, the recording when it is not — so a token a judge picks in the UI can always be
 * quoted even though the recording carries only ten assets.
 */
export function createDemoOneClickFetch(options: DemoOneClickOptions): FetchLike {
  let knownTokens: readonly DemoToken[] = DEMO_TOKENS;

  async function forward(url: string, init: RequestInit | undefined): Promise<Response | null> {
    const upstream = options.upstream;
    if (!upstream) return null;
    try {
      const headers = new Headers(init?.headers);
      headers.delete("authorization");
      if (upstream.jwt) headers.set("authorization", `Bearer ${upstream.jwt}`);
      const response = await upstream.fetch(url, { ...init, headers });
      return response.ok ? response : null;
    } catch {
      // Offline is a normal state for a demo, not an error: the recording answers instead.
      return null;
    }
  }

  async function handleTokens(url: string, init?: RequestInit): Promise<Response> {
    const forwarded = await forward(url, init);
    if (!forwarded) return jsonResponse(DEMO_TOKENS);

    const text = await forwarded.text();
    try {
      const list = JSON.parse(text) as DemoToken[];
      if (Array.isArray(list) && list.length > 0) knownTokens = list;
      else return jsonResponse(DEMO_TOKENS);
    } catch {
      return jsonResponse(DEMO_TOKENS);
    }
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  }

  async function handleQuote(request: Record<string, unknown>, url: string, init?: RequestInit) {
    const dry = request.dry === true;

    if (dry) {
      const forwarded = await forward(url, init);
      if (forwarded) {
        try {
          // Real numbers, demo signature: see the module header.
          return jsonResponse(signDemoQuote(await forwarded.json()));
        } catch {
          // An unparsable real answer is worse than a computed one; fall through to the demo quote.
        }
      }
    }

    // The judge picked a token the recording does not carry, so price it from the live list.
    const upstream = options.upstream;
    const wanted = [String(request.originAsset), String(request.destinationAsset)];
    if (
      upstream &&
      wanted.some((assetId) => !knownTokens.some((token) => token.assetId === assetId))
    ) {
      await handleTokens(`${upstream.baseUrl.replace(/\/+$/, "")}/v0/tokens`, { method: "GET" });
    }

    try {
      const body = demoQuoteBody(
        {
          originAsset: String(request.originAsset),
          destinationAsset: String(request.destinationAsset),
          amount: String(request.amount),
          recipient: String(request.recipient ?? ""),
          refundTo: String(request.refundTo ?? ""),
          deadline: String(request.deadline ?? new Date(options.now()).toISOString()),
          slippageTolerance: Number(request.slippageTolerance ?? 100),
          dry,
        },
        { tokens: knownTokens, now: options.now },
      );
      return jsonResponse(signDemoQuote(body));
    } catch (error) {
      if (error instanceof DemoQuoteError) return jsonResponse({ message: error.message }, 400);
      throw error;
    }
  }

  return async function demoFetch(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input);
    const path = url.pathname.replace(/\/+$/, "");
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;

    if (path === "/v0/tokens" && method === "GET") return handleTokens(input, init);

    if (path === "/v0/quote" && method === "POST") {
      if (!body) return jsonResponse({ message: "a quote needs a body" }, 400);
      return handleQuote(body, input, init);
    }

    if (path === "/v0/status" && method === "GET") {
      const depositAddress = url.searchParams.get("depositAddress");
      if (!depositAddress) return jsonResponse({ message: "depositAddress is required" }, 400);
      const stage = await options.stage(depositAddress);
      if (!stage) return notFound(`no execution status for ${depositAddress}`);
      return jsonResponse(
        demoStatusBody(stage, {
          correlationId: `demo-status-${depositAddress.slice(-8)}`,
          nowMs: options.now(),
        }),
      );
    }

    if (path === "/v0/deposit/submit" && method === "POST") {
      const depositAddress = body ? String(body.depositAddress ?? "") : "";
      const stage = depositAddress === "" ? null : await options.stage(depositAddress);
      if (!stage) return notFound(`no execution status for ${depositAddress || "(none)"}`);
      return jsonResponse({
        correlationId: `demo-submit-${options.now().toString(36)}`,
        status: stage.status === "PENDING_DEPOSIT" ? "KNOWN_DEPOSIT_TX" : stage.status,
        updatedAt: new Date(options.now()).toISOString(),
      });
    }

    return notFound(`demo mode does not serve ${path}`);
  };
}
