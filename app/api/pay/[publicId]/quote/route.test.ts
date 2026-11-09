import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.5, S3.8 · quote: the only public write, where the double-payment and funds-loss rules live.
import { POST } from "./route";
import { invoices, paymentAttempts, payoutDestinations } from "@/lib/db/schema";
import {
  TEST_NOW_MS,
  USDC_ON_NEAR,
  apiRequest,
  createRouteHarness,
  errorOf,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

beforeAll(async () => {
  harness = await createRouteHarness();
});

beforeEach(() => {
  harness.oneClick.reset();
});

afterAll(async () => {
  await harness?.close();
});

/** wNEAR on NEAR: a chain Settle can validate a refund address on. */
const WNEAR = "nep141:wrap.near";

function quoteBody(overrides: Record<string, unknown> = {}) {
  return { originAsset: WNEAR, refundTo: "payer.testnet", dry: true, ...overrides };
}

function quote(
  publicId: string,
  body: Record<string, unknown> = {},
  ip?: string,
): Promise<Response> {
  return POST(apiRequest(`/api/pay/${publicId}/quote`, { method: "POST", body, ip }), {
    params: Promise.resolve({ publicId }),
  });
}

async function storedAttempts(invoiceId: string) {
  return await harness.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.invoiceId, invoiceId));
}

function attemptOf(body: Record<string, unknown>): Record<string, unknown> {
  const attempt = body.attempt;
  if (typeof attempt !== "object" || attempt === null)
    throw new Error("quote response has no attempt");
  return attempt as Record<string, unknown>;
}

describe("POST /api/pay/:publicId/quote", () => {
  it("answers 404 for a link that is not an invoice", async () => {
    const response = await quote("nosuchlink", quoteBody());

    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it("previews a quote without storing anything", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice({
      destinationAddress: "seller-payout.testnet",
    });
    const body = await jsonOf(await quote(publicId, quoteBody()));

    expect(body).toMatchObject({ dry: true, reused: false, attempt: null, timeEstimateS: 45 });
    expect(body.deposit).toMatchObject({ assetId: WNEAR, baseUnits: "5050003", decimals: 24 });
    expect(body.payout).toMatchObject({
      assetId: USDC_ON_NEAR,
      baseUnits: "5000003",
      amount: "5.000003",
    });
    expect(body.feeUsd).toBe("0.01");
    // §3.2: a NEAR-origin deposit gets the 30-minute window.
    expect(body.deadline).toBe(new Date(TEST_NOW_MS + 30 * 60_000).toISOString());
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/quote")).toHaveLength(1);
    expect(await storedAttempts(invoiceId)).toEqual([]);
  });

  it("asks 1Click for the seller's destination, never for one the caller chose", async () => {
    const { publicId } = await harness.seededInvoice({
      destinationAddress: "seller-payout.testnet",
    });
    await quote(publicId, quoteBody({ dry: false }));

    const sent = harness.oneClick.quoteRequests()[0] as Record<string, unknown>;

    expect(sent).toMatchObject({
      destinationAsset: USDC_ON_NEAR,
      recipient: "seller-payout.testnet",
      amount: "5000003",
      refundTo: "payer.testnet",
      dry: false,
    });
  });

  it("stores the quote it verified, and makes the invoice payable again", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    // The last attempt was refunded (§3.3), so the client is allowed a fresh address.
    await harness.db.update(invoices).set({ status: "refunded" }).where(eq(invoices.id, invoiceId));

    const body = await jsonOf(await quote(publicId, quoteBody({ dry: false })));
    const [stored] = await storedAttempts(invoiceId);
    const [invoice] = await harness.db.select().from(invoices).where(eq(invoices.id, invoiceId));

    expect(body).toMatchObject({ dry: false, reused: false });
    expect(invoice?.status).toBe("open");
    expect(stored).toMatchObject({
      invoiceId,
      status: "awaiting_deposit",
      depositAddress: attemptOf(body).depositAddress,
      depositMemo: attemptOf(body).depositMemo,
      amountIn: "5050003",
      amountOut: "5000003",
      originAsset: WNEAR,
      refundTo: "payer.testnet",
    });
    expect(String(attemptOf(body).receiptUrl)).toContain("/receipt/");
  });

  it("hands back the same address instead of opening a second one", async () => {
    const { publicId } = await harness.seededInvoice();
    const first = await jsonOf(await quote(publicId, quoteBody({ dry: false })));
    const second = await jsonOf(await quote(publicId, quoteBody({ dry: false })));

    expect(second).toMatchObject({ reused: true });
    expect(attemptOf(second).id).toBe(attemptOf(first).id);
    // reuse answers from the row: 1Click is asked once, so a reload cannot create a second deposit id
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/quote")).toHaveLength(1);
  });

  it("refuses a second live quote on the same invoice", async () => {
    const { publicId } = await harness.seededInvoice();
    const opened = await jsonOf(await quote(publicId, quoteBody({ dry: false })));
    // A different refund address makes this a different quote, not a re-ask for the open one.
    const response = await quote(
      publicId,
      quoteBody({ dry: false, refundTo: "second-payer.testnet" }),
    );
    const error = await errorOf(response);

    expect(response.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(error.details).toMatchObject({
      depositAddress: attemptOf(opened).depositAddress,
      originAsset: WNEAR,
    });
  });

  it("refuses the token the invoice already pays out in, without asking for a quote (S7.4)", async () => {
    const { publicId } = await harness.seededInvoice({
      destinationAddress: "seller-payout.testnet",
    });
    const response = await quote(publicId, quoteBody({ originAsset: USDC_ON_NEAR }));
    const error = await errorOf(response);

    expect(response.status).toBe(409);
    expect(error.code).toBe("same_asset");
    expect(error.details).toMatchObject({ assetId: USDC_ON_NEAR, symbol: "USDC", chain: "near" });
    // Nothing was asked of 1Click: there is no conversion, so there is no route to price.
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/quote")).toHaveLength(0);
    // §6: the seller's address is not published through a public link, not even to explain a refusal.
    expect(JSON.stringify(error.details)).not.toContain("seller-payout.testnet");
  });

  it("names the memo a refund on that chain would need, instead of a bare 'unsupported' (S7.5)", async () => {
    const { publicId } = await harness.seededInvoice();
    const error = await errorOf(await quote(publicId, quoteBody({ originAsset: "openocean:BTC" })));

    expect(error.code).toBe("bad_request");
    expect(error.message).toContain("memo or destination tag");
    expect(error.details).toMatchObject({ blockchain: "btc" });
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/quote")).toHaveLength(0);
  });

  it("refuses a cancelled or unsent invoice", async () => {
    const cancelled = await harness.seededInvoice();
    await harness.db
      .update(invoices)
      .set({ status: "cancelled", cancelledAt: new Date(harness.deps.now()) })
      .where(eq(invoices.id, cancelled.invoiceId));

    expect((await quote(cancelled.publicId, quoteBody())).status).toBe(409);
    expect(
      (await quote((await harness.seededInvoice({ status: "draft" })).publicId, quoteBody()))
        .status,
    ).toBe(409);
  });

  it("refuses when the seller has no payout address yet", async () => {
    const seeded = await harness.seededInvoice();
    await harness.db.delete(payoutDestinations).where(eq(payoutDestinations.userId, seeded.userId));

    const response = await quote(seeded.publicId, quoteBody());
    const error = await errorOf(response);

    expect(response.status).toBe(409);
    expect(error.message).toContain("not set a payout address");
  });

  it("refuses a token that is not on the 1Click list", async () => {
    const { publicId } = await harness.seededInvoice();
    const response = await quote(publicId, quoteBody({ originAsset: "nep141:not-a-token" }));
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(error.details).toEqual({ originAsset: "nep141:not-a-token" });
  });

  it("refuses a chain whose refund address Settle cannot validate", async () => {
    const { publicId } = await harness.seededInvoice();
    const response = await quote(publicId, quoteBody({ originAsset: "openocean:BTC" }));
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(error.details).toEqual({ blockchain: "btc" });
    expect(error.message).toContain("near");
  });

  it("refuses a refund address that is not valid on the origin chain", async () => {
    const { publicId } = await harness.seededInvoice();
    const response = await quote(publicId, quoteBody({ refundTo: "Payer Account" }));

    expect(response.status).toBe(400);
    expect((await errorOf(response)).details).toEqual({ chain: "near" });
  });

  it("refuses a body that is missing the refund address", async () => {
    const { publicId } = await harness.seededInvoice();
    const response = await quote(publicId, { originAsset: WNEAR, dry: true });

    expect(response.status).toBe(400);
  });

  it("never shows a deposit address whose signature does not verify, and stores nothing", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    harness.oneClick.tamperedQuote();
    const response = await quote(publicId, quoteBody({ dry: false }));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "upstream_rejected" } });
    // an unverified address cannot reach the client, and cannot reach the database either
    expect(text).not.toContain("settle-deposit-");
    expect(await storedAttempts(invoiceId)).toEqual([]);
  });

  it("passes 1Click's minimum back to the client when the amount is too small", async () => {
    const { publicId } = await harness.seededInvoice();
    harness.oneClick.failOnce("/v0/quote", 400, {
      message: "Amount is too low for bridge, try at least 300001",
    });

    const response = await quote(publicId, quoteBody({ dry: false }));
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(error).toMatchObject({
      code: "amount_too_low",
      details: { minimumBaseUnits: "300001" },
    });
  });

  // The other refusal shape, seen live from a TRON-origin quote on 2026-11-09 (#135). What the
  // screen needs is the fact that it is an amount problem with a dollar floor — not a route problem.
  it("passes a dollar-denominated swap limit back as dollars, with no invented token amount", async () => {
    const { publicId } = await harness.seededInvoice();
    harness.oneClick.failOnce("/v0/quote", 400, {
      message: "Temporary swap limits: minimum swap amount is $100",
    });

    const response = await quote(publicId, quoteBody({ dry: false }));
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(error).toMatchObject({
      code: "amount_too_low",
      details: { minimumBaseUnits: null, minimumUsd: "100" },
    });
    expect(JSON.stringify(error)).not.toMatch(/"minimumBaseUnits":\s*"[0-9]/);
  });

  it("rate limits quote spam per pay page and caller, not globally", async () => {
    const { publicId } = await harness.seededInvoice();

    for (let i = 0; i < 6; i += 1) {
      expect((await quote(publicId, quoteBody())).status).toBe(200);
    }

    const blocked = await quote(publicId, quoteBody());
    const anotherCaller = await quote(publicId, quoteBody(), "198.51.100.7");

    expect(blocked.status).toBe(429);
    // a frozen clock means the 6-token bucket refills one token per 10 s
    expect(blocked.headers.get("retry-after")).toBe("10");
    expect(anotherCaller.status).toBe(200);
  });
});
