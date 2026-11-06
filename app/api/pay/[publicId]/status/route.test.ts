import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.6, S3.8 · the poll is where a payment becomes real: 1Click answers, never the client.
import { GET } from "./route";
import { POST as QUOTE } from "../quote/route";
import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { invoices, paymentAttempts } from "@/lib/db/schema";
import { parseBaseUnits } from "@/lib/core/money";
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

/** The quote's `amountIn` — what the client was asked to send. */
function askedOf(opened: Record<string, unknown>): bigint {
  const origin = opened.originAsset as { baseUnits: string };
  return BigInt(origin.baseUnits);
}

/** The fields of `AttemptView` these tests read. The full shape is pinned by the route's own tests. */
interface AttemptShape {
  id: string;
  status: string;
  deposited: { baseUnits: string } | null;
  shortfall: { baseUnits: string } | null;
  refunded: { baseUnits: string } | null;
  refundReason: string | null;
}

function attemptOf(body: Record<string, unknown>): AttemptShape {
  return body.attempt as AttemptShape;
}

/** The vendor's short-deposit report with the amount that landed replaced. */
function shortDeposit(depositedAmount: string) {
  return {
    ...structuredClone(statusesFixture.INCOMPLETE_DEPOSIT),
    swapDetails: { ...statusesFixture.INCOMPLETE_DEPOSIT.swapDetails, depositedAmount },
  };
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
      otherPayments: [],
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
    expect(attempt).toMatchObject({
      status: "awaiting_deposit",
      oneclickStatus: "PENDING_DEPOSIT",
    });
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

  it("states what arrived and what is still owed, so 'send the difference' is actionable (S7.1)", async () => {
    const { publicId } = await harness.seededInvoice();
    const opened = await openAttempt(publicId);
    const asked = askedOf(opened);
    // Half the ask, built from the quote this attempt actually got: the stored fixture's deposit is
    // not guaranteed to be short of every invoice, and a test that depends on that is a test that
    // passes for the wrong reason.
    const landed = asked / 2n;
    harness.oneClick.statuses(shortDeposit(landed.toString()));

    const body = await jsonOf(await status(publicId));
    const attempt = attemptOf(body);

    expect(body.invoiceStatus).toBe("underpaid");
    expect(attempt.deposited?.baseUnits).toBe(landed.toString());
    expect(attempt.shortfall?.baseUnits).toBe((asked - landed).toString());
    expect(attempt.refunded).toBeNull();
  });

  it("keeps the recorded amounts when a later write reports the status without them", async () => {
    const { publicId } = await harness.seededInvoice();
    const opened = await openAttempt(publicId);
    const asked = askedOf(opened);
    const landed = (asked / 2n).toString();
    harness.oneClick.statuses(shortDeposit(landed));
    const first = await jsonOf(await status(publicId));
    const attempt = attemptOf(first);

    // The worker re-reports the same status every 5 s. A write that carries no amounts must not read
    // back as "the deposit vanished" — that would flip a client from "still owed X" to "send it all".
    await recordAttemptStatus(harness.db, {
      attemptId: String(attempt.id),
      oneclickStatus: "INCOMPLETE_DEPOSIT",
    });
    const [row] = await harness.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, String(attempt.id)));

    expect(row?.depositedAmount).toBe(landed);
    expect(BigInt(row!.amountIn) - BigInt(row!.depositedAmount!)).toBe(asked - BigInt(landed));
  });

  it("returns a refunded payment to open so the client can try again", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.REFUNDED);

    const body = await jsonOf(await status(publicId));

    expect(body).toMatchObject({ invoiceStatus: "open", paid: false });
    expect(body.attempt).toMatchObject({ status: "refunded", id: attempt.id });

    // the refund is not the end of the pay page: a fresh address is allowed once the old one is dead
    expect(
      (
        await QUOTE(
          apiRequest(`/api/pay/${publicId}/quote`, {
            body: { originAsset: WNEAR, refundTo: "payer.testnet", dry: false },
          }),
          { params: Promise.resolve({ publicId }) },
        )
      ).status,
    ).toBe(200);
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
    expect(notFound).toMatchObject({
      polled: false,
      pollReason: "upstream_not_found",
      paid: false,
    });
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
    await recordAttemptStatus(harness.db, {
      attemptId: second.id,
      oneclickStatus: "SUCCESS",
      // The excess comes back to whoever sent it. Recorded without a status change, because the
      // attempt itself did succeed — it is the invoice that is overpaid.
      refundedAmount: parseBaseUnits("20000"),
      refundReason: "amount above the quote",
    });

    const body = await jsonOf(await status(publicId));

    expect(body).toMatchObject({ invoiceStatus: "overpaid", paid: true });
    expect(body.attempt).toMatchObject({ status: "success" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "overpaid" });
  });

  it("tells a client who paid twice about the other payment, without handing over its address (S7.2)", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);
    expect(await jsonOf(await status(publicId))).toMatchObject({ invoiceStatus: "paid" });

    const [first] = await listAttemptsForInvoice(harness.db, invoiceId);
    if (!first) throw new Error("the first attempt vanished");
    const second = await createPaymentAttempt(harness.db, {
      invoiceId,
      payoutDestinationId: first.payoutDestinationId,
      originAsset: first.originAsset,
      refundTo: first.refundTo,
      quote: {
        dry: false,
        depositAddress: "settle-deposit-8888",
        depositMemo: "memo-8888",
        amountIn: first.amountIn,
        amountOut: first.amountOut,
        feeUsd: first.feeUsd,
        deadline: first.quoteDeadline.toISOString(),
        timeEstimateS: 45,
        signature: first.quoteSignature,
        raw: statusesFixture.SUCCESS.quoteResponse,
      },
    });
    await recordAttemptStatus(harness.db, {
      attemptId: second.id,
      oneclickStatus: "SUCCESS",
      refundedAmount: parseBaseUnits("20000"),
      refundReason: "amount above the quote",
    });

    const body = await jsonOf(await status(publicId, "203.0.113.66"));
    const others = body.otherPayments as Record<string, unknown>[];

    // The newest attempt is the one shown in full — here that is the extra payment on its way
    // back — and the earlier one, which actually settled the invoice, is still reported.
    expect(others).toHaveLength(1);
    expect(others[0]).toMatchObject({ status: "success" });
    expect((others[0]!.deposited as { baseUnits: string }).baseUnits).toBe(
      "2700000000000000000000000",
    );
    const newest = attemptOf(body);
    expect(newest.refunded?.baseUnits).toBe("20000");
    expect(newest.refundReason).toBe("amount above the quote");

    // §6: this is a public read, and the other payment belongs to whoever made it.
    const serialised = JSON.stringify(others);
    expect(serialised).not.toContain(first.depositAddress);
    expect(serialised).not.toContain(first.refundTo);
    expect(serialised).not.toContain(second.id);
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
