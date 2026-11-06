/**
 * The demo transport: what it forwards, what it refuses to, and what it answers from the recording.
 * Roadmap: S6.1, S6.8 · Spec: ARCHITECTURE.md §3.2, §7 · AGENTS.md §8 (no network, no mocks of our own code)
 *
 * The point of these tests is that a demo quote is a *real* quote as far as the app is concerned: it is
 * parsed by the same schema and its signature is checked by the vendor's own verifier against the demo
 * manager key. The network is substituted, never the verification.
 */

import { describe, expect, it } from "vitest";

import {
  DEMO_MANAGER_PUBLIC_KEY,
  DEMO_TOKENS,
  buildDemoQuote,
  createDemoOneClickFetch,
  demoAmounts,
  demoQuoteBody,
  demoStatusBody,
  demoTxHash,
  signDemoQuote,
  type DemoStage,
  type DemoToken,
} from "./demo";
import { createOneClickClient, type FetchLike } from "./client";
import { getExecutionStatus } from "./status";
import { quoteResponseSchema, verifyQuoteSignature } from "./quote";

const NOW = Date.parse("2026-11-05T09:00:00Z");
const BASE_URL = "https://1click.invalid";

const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_ETH = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const WNEAR = "nep141:wrap.near";

/** An upstream that records every call, so "never forwarded" is an assertion and not a hope. */
function scriptedUpstream(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const calls: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push(new URL(input).pathname);
    return handler(input, init);
  };
  return { calls, upstream: { fetch, baseUrl: BASE_URL } };
}

function offlineUpstream() {
  return scriptedUpstream(async () => {
    throw new Error("the demo is offline");
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function transport(options: {
  stage?: (depositAddress: string) => Promise<DemoStage | null>;
  upstream?: { fetch: FetchLike; baseUrl: string; jwt?: string };
}): { fetch: FetchLike; client: ReturnType<typeof createOneClickClient> } {
  const fetch = createDemoOneClickFetch({
    now: () => NOW,
    stage: options.stage ?? (async () => null),
    ...(options.upstream ? { upstream: options.upstream } : {}),
  });
  return { fetch, client: createOneClickClient({ baseUrl: BASE_URL, fetchImpl: fetch }) };
}

const QUOTE_REQUEST = {
  originAsset: USDC_ETH,
  destinationAsset: USDC_NEAR,
  amount: "5000000",
  recipient: "ada.demo.near",
  refundTo: "0x9c4a1f7e2b8d6053c1e7a9f4b2d8063c5e1a7f94",
  deadline: new Date(NOW + 45 * 60_000).toISOString(),
};

describe("the demo transport — quotes", () => {
  it("answers a dry quote offline, signed so the vendor's own verifier accepts it", async () => {
    const { client } = transport({ upstream: offlineUpstream().upstream });

    const summary = await client.requestJson(quoteResponseSchema, {
      method: "POST",
      path: "/v0/quote",
      body: { ...QUOTE_REQUEST, dry: true, swapType: "EXACT_OUTPUT", amount: QUOTE_REQUEST.amount },
    });

    expect(verifyQuoteSignature(summary, DEMO_MANAGER_PUBLIC_KEY)).toBe(true);
    expect(summary.quoteRequest.dry).toBe(true);
    expect(summary.quote.depositAddress).toBeUndefined();
    // 5 USDC out at $1, plus the 1 % buffer the request asks for.
    expect(summary.quote.amountIn).toBe("5050000");
    expect(summary.quote.amountOut).toBe("5000000");
  });

  it("forwards a dry quote and re-signs the vendor's own numbers", async () => {
    // The recorded body stands in for a real answer; the amounts are made distinctive so the test can
    // tell "the vendor's figures survived" from "the demo recomputed them".
    const vendorBody = demoQuoteBody(
      { ...QUOTE_REQUEST, dry: true },
      { tokens: DEMO_TOKENS, now: () => NOW },
    );
    const vendorQuote = vendorBody.quote as Record<string, unknown>;
    vendorQuote.amountIn = "4999999";
    vendorQuote.minAmountIn = "4999999";
    vendorQuote.amountInUsd = "5.01";
    const scripted = scriptedUpstream(() => json(vendorBody));

    const { client } = transport({ upstream: scripted.upstream });
    const summary = await client.requestJson(quoteResponseSchema, {
      method: "POST",
      path: "/v0/quote",
      body: { ...QUOTE_REQUEST, dry: true },
    });

    expect(scripted.calls).toEqual(["/v0/quote"]);
    expect(summary.quote.amountIn).toBe("4999999");
    expect(verifyQuoteSignature(summary, DEMO_MANAGER_PUBLIC_KEY)).toBe(true);
  });

  it("never forwards a non-dry quote: a real address would be a real place to send money", async () => {
    const scripted = scriptedUpstream(() => json({ message: "must not be called" }));
    const { client } = transport({ upstream: scripted.upstream });

    const summary = await client.requestJson(quoteResponseSchema, {
      method: "POST",
      path: "/v0/quote",
      body: { ...QUOTE_REQUEST, dry: false },
    });

    expect(scripted.calls).toEqual([]);
    expect(summary.quote.depositAddress).toMatch(/^settle-demo-/);
    expect(verifyQuoteSignature(summary, DEMO_MANAGER_PUBLIC_KEY)).toBe(true);
  });

  it("gives every non-dry quote its own deposit address, which is what makes two attempts two payments", async () => {
    const { fetch } = transport({ upstream: offlineUpstream().upstream });
    const first = await (
      await fetch(`${BASE_URL}/v0/quote`, {
        method: "POST",
        body: JSON.stringify({ ...QUOTE_REQUEST, dry: false }),
      })
    ).json();
    const second = await (
      await fetch(`${BASE_URL}/v0/quote`, {
        method: "POST",
        body: JSON.stringify({ ...QUOTE_REQUEST, dry: false }),
      })
    ).json();

    const addressOf = (body: unknown) =>
      (body as { quote: { depositAddress: string } }).quote.depositAddress;
    expect(addressOf(first)).not.toBe(addressOf(second));
  });

  it("prices a token the recording lacks by adopting the live list", async () => {
    const liveToken: DemoToken = {
      assetId: "nep141:demo-only.near",
      decimals: 6,
      blockchain: "near",
      symbol: "DEMO",
      price: 2,
    };
    const scripted = scriptedUpstream((url) =>
      url.endsWith("/v0/tokens")
        ? json([...DEMO_TOKENS, liveToken])
        : json({ message: "unexpected" }),
    );
    const { client } = transport({ upstream: scripted.upstream });

    const summary = await client.requestJson(quoteResponseSchema, {
      method: "POST",
      path: "/v0/quote",
      body: { ...QUOTE_REQUEST, originAsset: liveToken.assetId, dry: false },
    });

    // 5 USDC out at $1 with a 1 % buffer is $5.05, and $5.05 of a $2 token is 2.525 units.
    expect(summary.quote.amountIn).toBe("2525000");
    expect(summary.quoteRequest.originAsset).toBe(liveToken.assetId);
  });

  it("answers 400 for a token nothing prices, rather than quoting it at zero", async () => {
    const worthless: DemoToken = {
      assetId: "nep141:worthless.near",
      decimals: 6,
      blockchain: "near",
      symbol: "WORTH",
      price: 0,
    };
    const scripted = scriptedUpstream((url) =>
      url.endsWith("/v0/tokens")
        ? json([...DEMO_TOKENS, worthless])
        : json({ message: "unexpected" }),
    );
    const { fetch } = transport({ upstream: scripted.upstream });

    const response = await fetch(`${BASE_URL}/v0/quote`, {
      method: "POST",
      body: JSON.stringify({ ...QUOTE_REQUEST, originAsset: worthless.assetId, dry: false }),
    });
    const body = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    expect(body.message).toContain(worthless.assetId);
  });
});

describe("the demo transport — status, submit and tokens", () => {
  it("mirrors the caller's stage reader, and reads as a real status to the real client", async () => {
    const stage: DemoStage = {
      status: "SUCCESS",
      depositedAmount: "5050000",
      depositTxHash: demoTxHash("deposit"),
      deliveryTxHash: demoTxHash("delivery"),
      quoteResponse: buildDemoQuote(QUOTE_REQUEST, { now: () => NOW }).raw,
    };
    const { client } = transport({ stage: async () => stage });

    const execution = await getExecutionStatus(client, "settle-demo-abc", null);

    expect(execution.status).toBe("SUCCESS");
    expect(execution.depositTxHashes).toEqual([demoTxHash("deposit")]);
    expect(execution.deliveryTxHashes).toEqual([demoTxHash("delivery")]);
  });

  it("reports a short deposit as the service does, with the figure the mirror was given", async () => {
    const { client } = transport({
      stage: async () => ({
        status: "INCOMPLETE_DEPOSIT",
        depositedAmount: "2500000",
        depositTxHash: demoTxHash("short"),
      }),
    });

    const execution = await getExecutionStatus(client, "settle-demo-short", null);
    expect(execution.status).toBe("INCOMPLETE_DEPOSIT");
    expect(execution.depositedAmount).toBe("2500000");
  });

  it("answers 404 for a deposit address nobody knows, so 'no signal yet' is never 'not paid'", async () => {
    const { fetch } = transport({ stage: async () => null });
    const response = await fetch(`${BASE_URL}/v0/status?depositAddress=settle-demo-unknown`, {
      method: "GET",
    });
    expect(response.status).toBe(404);
  });

  it("takes a reported deposit as the service would: PENDING_DEPOSIT becomes KNOWN_DEPOSIT_TX", async () => {
    const { fetch } = transport({ stage: async () => ({ status: "PENDING_DEPOSIT" }) });
    const body = (await (
      await fetch(`${BASE_URL}/v0/deposit/submit`, {
        method: "POST",
        body: JSON.stringify({ txHash: demoTxHash("reported"), depositAddress: "settle-demo-a" }),
      })
    ).json()) as { status: string };

    expect(body.status).toBe("KNOWN_DEPOSIT_TX");
  });

  it("serves the recorded token list offline, and the forwarded one when there is a network", async () => {
    const offline = transport({ upstream: offlineUpstream().upstream });
    const recorded = (await (await offline.fetch(`${BASE_URL}/v0/tokens`)).json()) as DemoToken[];
    expect(recorded).toHaveLength(DEMO_TOKENS.length);

    const scripted = scriptedUpstream(() => json([DEMO_TOKENS[0]]));
    const online = transport({ upstream: scripted.upstream });
    const forwarded = (await (await online.fetch(`${BASE_URL}/v0/tokens`)).json()) as DemoToken[];
    expect(forwarded).toHaveLength(1);
  });

  it("answers 404 for an endpoint the app does not use, instead of inventing one", async () => {
    const { fetch } = transport({});
    expect((await fetch(`${BASE_URL}/v0/history`)).status).toBe(404);
  });
});

describe("the demo's money and hash helpers", () => {
  it("converts at the recorded prices, with the slippage buffer on the deposit side only", () => {
    const origin = DEMO_TOKENS.find((token) => token.assetId === WNEAR)!;
    const destination = DEMO_TOKENS.find((token) => token.assetId === USDC_NEAR)!;

    // $100 out at 6 decimals, wNEAR at $3.85 with 24 decimals, plus 1 %.
    const amounts = demoAmounts({
      amountOut: "100000000",
      origin,
      destination,
      slippageTolerance: 100,
    });

    expect(amounts.amountOutUsd).toBe("100");
    expect(amounts.amountInUsd).toBe("101");
    expect(amounts.amountIn).toBe(((BigInt("10100000000") * 10n ** 24n) / 385000000n).toString());
  });

  it("makes the same hash for the same seed, shaped like a transaction and visibly not one", () => {
    const hash = demoTxHash("INV-0001:deposit");
    expect(hash).toBe(demoTxHash("INV-0001:deposit"));
    expect(hash).toHaveLength(44);
    expect(hash).not.toBe(demoTxHash("INV-0001:delivery"));
  });

  it("signs a quote body the vendor's verifier then accepts, and rejects one it altered", () => {
    const signed = signDemoQuote(
      demoQuoteBody(QUOTE_REQUEST, { tokens: DEMO_TOKENS, now: () => NOW }),
    );
    expect(verifyQuoteSignature(signed, DEMO_MANAGER_PUBLIC_KEY)).toBe(true);

    const tampered = { ...signed, quote: { ...signed.quote, amountOut: "1" } };
    expect(verifyQuoteSignature(tampered, DEMO_MANAGER_PUBLIC_KEY)).toBe(false);
  });

  it("builds a status body that carries this payment's hashes, not the recorded payment's", () => {
    const body = demoStatusBody(
      { status: "REFUNDED", refundedAmount: "5050000", depositTxHash: demoTxHash("refund") },
      { correlationId: "demo-1", nowMs: NOW },
    );

    expect(body.status).toBe("REFUNDED");
    const details = body.swapDetails as Record<string, unknown>;
    expect(details.refundedAmount).toBe("5050000");
    expect(details.depositedAmountFormatted).toBeUndefined();
    expect((details.originChainTxHashes as { hash: string }[])[0]?.hash).toBe(demoTxHash("refund"));
  });
});
