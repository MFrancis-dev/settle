import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.6, S3.8 · the poll is where a payment becomes real: 1Click answers, never the client.
import { GET } from "./route";
import { POST as QUOTE } from "../quote/route";
import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { invoices } from "@/lib/db/schema";
import {
  createPaymentAttempt,
  listAttemptsForInvoice,
  recordAttemptStatus,
} from "@/lib/db/queries/paymentAttempts";
import {
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

const WNEAR = "nep141:wrap.near";

function status(publicId: string, ip?: string): Promise<Response> {
  return GET(apiRequest(`/api/pay/${publicId}/status`, { ip }), {
    params: Promise.resolve({ publicId }),
  });
}

async function openAttempt(publicId: string) {
  const body = await jsonOf(
    await QUOTE(
      apiRequest(`/api/pay/${publicId}/quote`, {
        body: { originAsset: WNEAR, refundTo: "payer.testnet", dry: false },
      }),
      { params: Promise.resolve({ publicId }) },
    ),
  );
  return body.attempt as Record<string, unknown>;
}

async function storedInvoice(invoiceId: string) {
  const [row] = await harness.db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!row) throw new Error("invoice vanished");
  return row;
}

describe("GET /api/pay/:publicId/status", () => {
  it("answers 404 for a link that is not an invoice", async () => {
    expect((await status("nosuchlink")).status).toBe(404);
  });

  it("reports 'no attempt' instead of pretending to have polled", async () => {
    const { publicId } = await harness.seededInvoice();
    const body = await jsonOf(await status(publicId));

    expect(body).toEqual({
      invoiceStatus: "open",
      attempt: null,
      polled: false,
      pollReason: "no_attempt",
      paid: false,
      receiptUrl: null,
    });
    // no attempt means no call: this route does not ask 1Click about a deposit that does not exist
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/status")).toEqual([]);
  });

  it("asks 1Click about the deposit address the client was given", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);

    await status(publicId);

    const call = harness.oneClick.calls.find((entry) => entry.path === "/v0/status");
    expect(call?.query).toMatchObject({
      depositAddress: String(attempt.depositAddress),
      depositMemo: String(attempt.depositMemo),
    });
  });

  it("shows the quote still waiting for a deposit", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);

    const body = await jsonOf(await status(publicId));
    const attempt = body.attempt as Record<string, unknown>;

    expect(body).toMatchObject({
      invoiceStatus: "open",
      polled: true,
      pollReason: null,
      paid: false,
    });
    expect(attempt).toMatchObject({ status: "awaiting_deposit", oneclickStatus: "PENDING_DEPOSIT" });
    // the link exists from the moment the attempt does; the document it opens shows the status
    expect(body.receiptUrl).toBe(attempt.receiptUrl);
  });

  it("follows the money from detected to processing", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.KNOWN_DEPOSIT_TX, statusesFixture.PROCESSING);

    const detected = await jsonOf(await status(publicId));
    expect(detected).toMatchObject({ invoiceStatus: "payment_detected", paid: false });
    const detectedTx = (detected.attempt as Record<string, unknown>).depositTxHash;
    expect(typeof detectedTx).toBe("string");

    const processing = await jsonOf(await status(publicId));
    expect(processing).toMatchObject({ invoiceStatus: "processing" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "processing" });
  });

  it("marks the invoice paid and hands back the receipt when 1Click says SUCCESS", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    const body = await jsonOf(await status(publicId));
    const attempt = body.attempt as Record<string, unknown>;

    expect(body).toMatchObject({ invoiceStatus: "paid", paid: true, polled: true });
    expect(attempt).toMatchObject({ status: "success", oneclickStatus: "SUCCESS" });
    expect(String(body.receiptUrl)).toBe(String(attempt.receiptUrl));
    expect(String(body.receiptUrl)).toContain("/receipt/");
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "paid" });
  });

  it("reports a short deposit as underpaid, not as paid", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.INCOMPLETE_DEPOSIT);

    const body = await jsonOf(await status(publicId));

    expect(body).toMatchObject({ invoiceStatus: "underpaid", paid: false });
    expect(body.attempt).toMatchObject({ status: "underpaid" });
  });

  it("returns a refunded payment to open so the client can try again", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.REFUNDED);

    const body = await jsonOf(await status(publicId));

    expect(body).toMatchObject({ invoiceStatus: "open", paid: false });
    expect(body.attempt).toMatchObject({ status: "refunded", id: attempt.id });

    // the refund is not the end of the pay page: a fresh address is allowed once the old one is dead
    expect((await QUOTE(apiRequest(`/api/pay/${publicId}/quote`, {
      body: { originAsset: WNEAR, refundTo: "payer.testnet", dry: false },
    }), { params: Promise.resolve({ publicId }) })).status).toBe(200);
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "open" });
  });

  it("records money that arrives after a cancel as paid_after_cancel", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    await harness.db
      .update(invoices)
      .set({ status: "cancelled", cancelledAt: new Date(harness.deps.now()) })
      .where(eq(invoices.id, invoiceId));
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    const body = await jsonOf(await status(publicId));

    expect(body).toMatchObject({ invoiceStatus: "paid_after_cancel", paid: true });
  });

  it("keeps 'no update' separate from 'not paid' when 1Click is down", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);

    // nothing queued: the stub answers 404 the way 1Click does for a deposit it has never seen
    const notFound = await jsonOf(await status(publicId));
    expect(notFound).toMatchObject({ polled: false, pollReason: "upstream_not_found", paid: false });
    expect(notFound.attempt).toMatchObject({ id: attempt.id });

    harness.oneClick.failOnce("/v0/status", 500);
    const unreachable = await jsonOf(await status(publicId));
    expect(unreachable).toMatchObject({ polled: false, pollReason: "upstream_unreachable" });
  });

  it("reports the second success on an invoice as an overpayment", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);
    expect(await jsonOf(await status(publicId))).toMatchObject({ invoiceStatus: "paid" });

    // The API will not open a second live quote on a paid invoice (§3.2), so the second attempt is
    // written the way the worker writes it: a verified quote, then the status 1Click reported.
    const [first] = await listAttemptsForInvoice(harness.db, invoiceId);
    if (!first) throw new Error("the first attempt vanished");
    const second = await createPaymentAttempt(harness.db, {
      invoiceId,
      payoutDestinationId: first.payoutDestinationId,
      originAsset: first.originAsset,
      refundTo: first.refundTo,
      quote: {
        dry: false,
        depositAddress: "settle-deposit-9999",
        depositMemo: "memo-9999",
        amountIn: first.amountIn,
        amountOut: first.amountOut,
        feeUsd: first.feeUsd,
        deadline: first.quoteDeadline.toISOString(),
        timeEstimateS: 45,
        signature: first.quoteSignature,
        raw: statusesFixture.SUCCESS.quoteResponse,
      },
    });
    await recordAttemptStatus(harness.db, { attemptId: second.id, oneclickStatus: "SUCCESS" });

    const body = await jsonOf(await status(publicId));

    expect(body).toMatchObject({ invoiceStatus: "overpaid", paid: true });
    expect(body.attempt).toMatchObject({ status: "success" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "overpaid" });
  });

  it("refuses to walk a settled payment back instead of silently mis-reporting it", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);
    expect((await status(publicId)).status).toBe(200);

    // a stale read arriving after SUCCESS is a mapping bug, and swallowing one is how a paid
    // invoice starts showing "send the money again"
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);
    const response = await status(publicId);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("internal_error");
  });

  it("rate limits the poll per pay page and caller at 60 a minute", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);

    for (let i = 0; i < 60; i += 1) {
      expect((await status(publicId)).status).toBe(200);
    }

    const blocked = await status(publicId);
    const anotherCaller = await status(publicId, "198.51.100.11");

    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe("rate_limited");
    expect(anotherCaller.status).toBe(200);
  });
});
