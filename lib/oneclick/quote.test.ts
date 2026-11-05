/**
 * S2.4 — the recorded quote fixtures run through the vendor's own verifier.
 * Spec: ARCHITECTURE.md §3.2 · AGENTS.md §6 (a deposit address is never returned unverified)
 *
 * The fixtures are payload-shaped like the live API but carry a placeholder signature; the
 * test key in `__fixtures__/signing.ts` re-signs them, which gives both halves the roadmap
 * asks for: a quote the real `verifyQuoteSignature()` accepts, and one that stops verifying
 * the moment a signed field is edited.
 */

import { describe, expect, it } from "vitest";

import quoteDryFixture from "./__fixtures__/quote-dry.json";
import quoteRealFixture from "./__fixtures__/quote-real.json";
import { signFixture, tamperAmountOut, TEST_MANAGER_PUBLIC_KEY } from "./__fixtures__/signing";

import { parseBaseUnits } from "../core/money";
import { createOneClickClient, OneClickError, type FetchLike } from "./client";
import {
  buildInvoiceQuoteRequest,
  DEFAULT_SLIPPAGE_BPS,
  quoteResponseSchema,
  QuoteSignatureError,
  requestInvoiceQuote,
  verifyQuoteSignature,
  type InvoiceQuoteParams,
} from "./quote";

const USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const params: InvoiceQuoteParams = {
  originAsset: "nep141:wrap.near",
  refundTo: "client.near",
  destinationAsset: USDC_ON_NEAR,
  recipient: "freelancer.near",
  amountOut: parseBaseUnits("10000000"),
  deadline: "2026-11-05T11:00:00Z",
};

/** A client that answers every call with `body`, remembering what it was asked. */
function answering(body: unknown) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    requests.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { requests, client: createOneClickClient({ fetchImpl }) };
}

function quoteOf(body: unknown) {
  return signFixture(body);
}

describe("buildInvoiceQuoteRequest", () => {
  it("asks for EXACT_OUTPUT so the payout amount is the fixed side", () => {
    expect(buildInvoiceQuoteRequest(params, { dry: false })).toEqual({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: DEFAULT_SLIPPAGE_BPS,
      originAsset: "nep141:wrap.near",
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_ON_NEAR,
      amount: "10000000",
      refundTo: "client.near",
      refundType: "ORIGIN_CHAIN",
      recipient: "freelancer.near",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-05T11:00:00Z",
    });
  });

  it("puts the dry flag on the request rather than dropping the preview", () => {
    expect(buildInvoiceQuoteRequest(params, { dry: true }).dry).toBe(true);
  });

  it("uses the 1% default and honours an override", () => {
    expect(DEFAULT_SLIPPAGE_BPS).toBe(100);
    expect(
      buildInvoiceQuoteRequest({ ...params, slippageBps: 250 }, { dry: false }).slippageTolerance,
    ).toBe(250);
  });
});

describe("verifyQuoteSignature", () => {
  it("accepts a fixture signed by the test key", () => {
    expect(verifyQuoteSignature(quoteOf(quoteRealFixture), TEST_MANAGER_PUBLIC_KEY)).toBe(true);
  });

  it("rejects the placeholder signature stored in the fixture", () => {
    const unsigned = quoteResponseSchema.parse(quoteRealFixture);
    expect(verifyQuoteSignature(unsigned, TEST_MANAGER_PUBLIC_KEY)).toBe(false);
  });

  it("rejects a quote whose payout was edited after signing", () => {
    const signed = quoteOf(quoteRealFixture);
    // The funds-loss case: the address still parses, the amount it delivers no longer matches.
    expect(verifyQuoteSignature(tamperAmountOut(signed, "9000000"), TEST_MANAGER_PUBLIC_KEY)).toBe(
      false,
    );
  });

  it("rejects when verified against a different manager key", () => {
    // Proves the key is a real input, so a rotation cannot leave us trusting old quotes.
    expect(verifyQuoteSignature(quoteOf(quoteRealFixture))).toBe(false);
  });
});

describe("requestInvoiceQuote (real quote)", () => {
  const signed = quoteOf(quoteRealFixture);

  it("posts the built request to /v0/quote and returns the stored summary", async () => {
    const { requests, client } = answering(signed);
    const summary = await requestInvoiceQuote(client, params, {
      dry: false,
      managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://1click.chaindefuser.com/v0/quote");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      dry: false,
      amount: "10000000",
      deadline: "2026-11-05T11:00:00Z",
    });

    expect(summary).toMatchObject({
      dry: false,
      depositAddress: "settle-deposit-0001",
      depositMemo: null,
      amountIn: "2700000000000000000000000",
      amountOut: "10000000",
      feeUsd: "0.4", // 10.40 − 10.00, trailing zeros trimmed
      deadline: "2026-11-05T11:00:00Z",
      timeEstimateS: 45,
      signature: signed.signature,
    });
    expect(summary.raw).toEqual(signed);
  });

  it("keeps amountIn/amountOut as exact base units, not the formatted display strings", async () => {
    const { client } = answering(signed);
    const summary = await requestInvoiceQuote(client, params, {
      dry: false,
      managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
    });
    expect(summary.amountIn).toBe("2700000000000000000000000");
    expect(BigInt(summary.amountIn)).toBe(2_700_000_000_000_000_000_000_000n);
  });

  it("refuses to return a deposit address when the signature does not verify", async () => {
    const { client } = answering(tamperAmountOut(signed, "9000000"));
    await expect(
      requestInvoiceQuote(client, params, {
        dry: false,
        managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
      }),
    ).rejects.toBeInstanceOf(QuoteSignatureError);

    // The correlation id is what the vendor can look up; the address must not reach the message.
    const error = await requestInvoiceQuote(client, params, {
      dry: false,
      managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
    }).catch((cause: unknown) => cause);
    expect((error as QuoteSignatureError).message).toContain(signed.correlationId);
    expect((error as QuoteSignatureError).message).not.toContain("settle-deposit-0001");
  });

  it("treats a signed non-dry quote without a deposit address as a broken response", async () => {
    // Signed here so the signature check is not what rejects it: this is the vendor's own bug.
    const noAddress = {
      ...quoteDryFixture,
      quoteRequest: { ...quoteDryFixture.quoteRequest, dry: false },
    };
    const { client } = answering(signFixture(noAddress));
    await expect(
      requestInvoiceQuote(client, params, {
        dry: false,
        managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
      }),
    ).rejects.toThrowError(OneClickError);
    await expect(
      requestInvoiceQuote(client, params, {
        dry: false,
        managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
      }),
    ).rejects.toThrow(/must carry a depositAddress/);
  });

  it("reports no fee when the input is worth less than the payout", async () => {
    // Signed with those numbers, the way the vendor would have: only the fee maths is under test.
    const cheapInput = {
      ...quoteRealFixture,
      quote: { ...quoteRealFixture.quote, amountInUsd: "9.00" },
    };
    const { client } = answering(signFixture(cheapInput));
    const summary = await requestInvoiceQuote(client, params, {
      dry: false,
      managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
    });
    expect(summary.feeUsd).toBeNull();
  });
});

describe("requestInvoiceQuote (dry preview)", () => {
  it("returns the preview with no address and never claims to be persistable", async () => {
    const { client } = answering(quoteOf(quoteDryFixture));
    const summary = await requestInvoiceQuote(client, params, {
      dry: true,
      managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
    });
    expect(summary).toMatchObject({
      dry: true,
      depositAddress: null,
      amountIn: "2700000000000000000000000",
      amountOut: "10000000",
      feeUsd: "0.4",
    });
  });

  it("falls back to the requested deadline when the preview omits one", async () => {
    const { client } = answering(quoteOf(quoteDryFixture));
    const summary = await requestInvoiceQuote(client, params, {
      dry: true,
      managerPublicKey: TEST_MANAGER_PUBLIC_KEY,
    });
    expect(summary.deadline).toBe(params.deadline);
  });

  it("rejects an unsigned preview too — a quote is only ever read after verification", async () => {
    const { client } = answering(quoteDryFixture);
    await expect(
      requestInvoiceQuote(client, params, { dry: true, managerPublicKey: TEST_MANAGER_PUBLIC_KEY }),
    ).rejects.toThrow(/no valid signature on preview quote/);
  });
});
