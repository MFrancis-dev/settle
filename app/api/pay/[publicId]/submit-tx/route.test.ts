import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.6, S3.8 · submitting the deposit is an optimisation: it must never be able to lose money.
import { POST } from "./route";
import { POST as QUOTE } from "../quote/route";
import { GET as STATUS } from "../status/route";
import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { invoices, paymentAttempts } from "@/lib/db/schema";
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
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const EVM_PAYER = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TX_HASH = "7SiwnYUbZDMsJT83zUgxFDDHABCDEF123456GHJKLMNO";

function submit(publicId: string, body: unknown, ip?: string): Promise<Response> {
  return POST(apiRequest(`/api/pay/${publicId}/submit-tx`, { method: "POST", body, ip }), {
    params: Promise.resolve({ publicId }),
  });
}

/** Open a real quote through the route, so the attempt under test is one the API itself stored. */
async function openAttempt(
  publicId: string,
  originAsset = WNEAR,
  refundTo = "payer.testnet",
): Promise<Record<string, unknown>> {
  const body = await jsonOf(
    await QUOTE(
      apiRequest(`/api/pay/${publicId}/quote`, { body: { originAsset, refundTo, dry: false } }),
      { params: Promise.resolve({ publicId }) },
    ),
  );
  const attempt = body.attempt;
  if (typeof attempt !== "object" || attempt === null) throw new Error("quote returned no attempt");
  return attempt as Record<string, unknown>;
}

async function storedAttempt(invoiceId: string) {
  const [row] = await harness.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.invoiceId, invoiceId));
  if (!row) throw new Error("no attempt stored for that invoice");
  return row;
}

describe("POST /api/pay/:publicId/submit-tx", () => {
  it("answers 404 for a link that is not an invoice", async () => {
    const response = await submit("nosuchlink", { txHash: TX_HASH });

    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it("refuses an empty or absurdly long tx hash", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);

    expect((await submit(publicId, { txHash: "" })).status).toBe(400);
    expect((await submit(publicId, { txHash: "x".repeat(300) })).status).toBe(400);
  });

  it("refuses before the client has a payment address", async () => {
    const { publicId } = await harness.seededInvoice();
    const response = await submit(publicId, { txHash: TX_HASH });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).message).toContain("Get a payment address first");
  });

  it("refuses an invoice that is already paid", async () => {
    const seeded = await harness.seededInvoice();
    await harness.db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, seeded.invoiceId));

    const response = await submit(seeded.publicId, { txHash: TX_HASH });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).message).toContain("already paid");
  });

  it("forwards the deposit and reports the payment as detected", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);

    const body = await jsonOf(await submit(publicId, { txHash: TX_HASH }));

    expect(body).toMatchObject({ forwarded: true, oneclickStatus: "KNOWN_DEPOSIT_TX" });
    expect(body.attempt).toMatchObject({ id: attempt.id, status: "payment_detected" });
    expect(await storedAttempt(invoiceId)).toMatchObject({
      status: "payment_detected",
      oneclickStatus: "KNOWN_DEPOSIT_TX",
      depositTxHash: TX_HASH,
    });
  });

  it("sends the deposit address, the memo, and for NEAR the sending account", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId, WNEAR, "payer.testnet");

    await submit(publicId, { txHash: TX_HASH });

    const call = harness.oneClick.calls.find((entry) => entry.path === "/v0/deposit/submit");
    expect(call?.body).toMatchObject({
      txHash: TX_HASH,
      depositAddress: attempt.depositAddress,
      memo: attempt.depositMemo,
      // §3.4: a NEAR deposit comes from `refundTo`, so the service can verify it immediately.
      nearSenderAccount: "payer.testnet",
    });
  });

  it("does not claim a sender account for a deposit that is not on NEAR", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId, BASE_USDC, EVM_PAYER);

    const response = await jsonOf(await submit(publicId, { txHash: TX_HASH }));

    expect(response.forwarded).toBe(true);
    const call = harness.oneClick.calls.find((entry) => entry.path === "/v0/deposit/submit");
    expect(call?.body).not.toHaveProperty("nearSenderAccount");
  });

  it("still says 200 when 1Click is unreachable, because the money really was sent", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.failOnce("/v0/deposit/submit", 500);

    const response = await submit(publicId, { txHash: TX_HASH });
    const body = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ forwarded: false, oneclickStatus: null });
    expect(body.attempt).toMatchObject({ id: attempt.id, status: "awaiting_deposit" });
    // nothing was written: the poll keeps the truth, this route never invents it
    expect(await storedAttempt(invoiceId)).toMatchObject({
      status: "awaiting_deposit",
      depositTxHash: null,
    });
  });

  it("keeps working after a failed submit — the pay page can retry", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.failOnce("/v0/deposit/submit", 500);

    expect((await jsonOf(await submit(publicId, { txHash: TX_HASH }))).forwarded).toBe(false);
    expect((await jsonOf(await submit(publicId, { txHash: TX_HASH }))).forwarded).toBe(true);
    expect((await storedAttempt(invoiceId)).status).toBe("payment_detected");
  });

  it("rate limits per pay page and caller", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);

    for (let i = 0; i < 6; i += 1) {
      expect((await submit(publicId, { txHash: TX_HASH })).status).toBe(200);
    }

    const blocked = await submit(publicId, { txHash: TX_HASH });
    const anotherCaller = await submit(publicId, { txHash: TX_HASH }, "198.51.100.9");

    expect(blocked.status).toBe(429);
    expect(anotherCaller.status).toBe(200);
  });

  it("leaves the status the poll reports, not the one the submit answered with", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    await submit(publicId, { txHash: TX_HASH });
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    const status = await jsonOf(
      await STATUS(apiRequest(`/api/pay/${publicId}/status`), { params: Promise.resolve({ publicId }) }),
    );

    expect(status).toMatchObject({ paid: true, invoiceStatus: "paid" });
  });

  it("moves the invoice with the attempt, so the dashboard is not a poll behind", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);

    const body = await jsonOf(await submit(publicId, { txHash: TX_HASH }));
    const [invoice] = await harness.db.select().from(invoices).where(eq(invoices.id, invoiceId));

    // The submit answer says the deposit tx is known; the invoice row must already agree rather
    // than wait for the next status poll (S5.2 re-derives from every attempt, same as here).
    expect(body.attempt).toMatchObject({ status: "payment_detected" });
    expect(invoice).toMatchObject({ status: "payment_detected" });
  });
});
