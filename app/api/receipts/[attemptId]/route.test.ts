import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.7, S3.8 · the receipt is the document a dispute starts from: signed quote + real status.
import { GET } from "./route";
import { POST as QUOTE } from "../../pay/[publicId]/quote/route";
import { GET as STATUS } from "../../pay/[publicId]/status/route";
import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { paymentAttempts } from "@/lib/db/schema";
import {
  APP_ORIGIN,
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

const WNEAR = "nep141:wrap.near";
const NOT_AN_ATTEMPT = "00000000-0000-4000-8000-000000000000";

function receipt(attemptId: string, token?: string): Promise<Response> {
  const query = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
  return GET(apiRequest(`/api/receipts/${attemptId}${query}`), {
    params: Promise.resolve({ attemptId }),
  });
}

async function quoteAttempt(publicId: string): Promise<Record<string, unknown>> {
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

/** Open a quote, let 1Click report SUCCESS through the poll, and return the link's two halves. */
async function paidReceipt(destinationAddress = "seller-payout.testnet") {
  const seeded = await harness.seededInvoice({ destinationAddress });
  const attempt = await quoteAttempt(seeded.publicId);
  harness.oneClick.statuses(statusesFixture.SUCCESS);
  await STATUS(apiRequest(`/api/pay/${seeded.publicId}/status`), {
    params: Promise.resolve({ publicId: seeded.publicId }),
  });

  const [row] = await harness.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, String(attempt.id)));
  if (!row?.receiptToken) throw new Error("the attempt lost its receipt token");

  return { ...seeded, attempt: row, attemptId: String(attempt.id), token: row.receiptToken };
}

describe("GET /api/receipts/:attemptId", () => {
  it("refuses a link with no token, and one too short to be a token", async () => {
    const missing = await receipt(NOT_AN_ATTEMPT);
    const short = await receipt(NOT_AN_ATTEMPT, "abc");

    expect(missing.status).toBe(400);
    expect((await errorOf(missing)).code).toBe("bad_request");
    expect(short.status).toBe(400);
  });

  it("answers the same 404 for a wrong token, an unknown attempt and a malformed id", async () => {
    const { attemptId, token } = await paidReceipt();
    const wrongToken = await receipt(attemptId, `not-the-token-${token.slice(0, 8)}`);
    const unknownAttempt = await receipt(NOT_AN_ATTEMPT, token);
    const malformed = await receipt("hello-world", token);

    // one reply for all three: the link cannot be used to find out which attempts exist (§6)
    const bodies = await Promise.all([errorOf(wrongToken), errorOf(unknownAttempt), errorOf(malformed)]);
    const messages = bodies.map((body) => body.message);
    expect(messages).toEqual(["No such receipt.", "No such receipt.", "No such receipt."]);
  });

  it("states what was promised and what actually moved", async () => {
    const { attemptId, token, attempt, total } = await paidReceipt();
    const response = await receipt(attemptId, token);
    const body = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      attemptId,
      status: "success",
      oneclickStatus: "SUCCESS",
      invoice: { number: "INV-0001", clientName: "Client Co" },
      sent: { assetId: WNEAR, baseUnits: "5050003", symbol: "wNEAR", decimals: 24 },
      delivered: { assetId: USDC_ON_NEAR, baseUnits: total, amount: "5.000003" },
      feeUsd: "0.01",
      quoteDeadline: new Date(TEST_NOW_MS + 30 * 60_000).toISOString(),
      paidAt: new Date(TEST_NOW_MS).toISOString(),
      receiptUrl: `${APP_ORIGIN}/receipt/${token}`,
    });
    expect(body.deposit).toMatchObject({
      address: attempt.depositAddress,
      memo: attempt.depositMemo,
    });
    // the attestation the quote was stored with, unchanged — a dispute starts from this number
    expect(body.quoteSignature).toBe(attempt.quoteSignature);
  });

  it("carries the transaction links 1Click reported", async () => {
    const { attemptId, token } = await paidReceipt();
    const body = await jsonOf(await receipt(attemptId, token));

    const links = (txs: { hash: string; explorerUrl: string }[]) =>
      txs.map((tx) => ({ hash: tx.hash, url: tx.explorerUrl }));

    expect(body.depositTxs).toEqual(links(statusesFixture.SUCCESS.swapDetails.originChainTxHashes));
    expect(body.deliveryTxs).toEqual(links(statusesFixture.SUCCESS.swapDetails.destinationChainTxHashes));
  });

  it("does not turn the payer's refund address or the seller's payout into public data", async () => {
    const { attemptId, token } = await paidReceipt();
    const text = await (await receipt(attemptId, token)).text();

    // §6: the link is meant to be forwarded to an accountant, so it carries proof, not the
    // addresses the next payment would be built from.
    expect(text).not.toContain("payer.testnet");
    expect(text).not.toContain("seller-payout.testnet");
    expect(text).not.toContain("refundTo");
    expect(text).not.toContain("payoutDestinationId");
  });

  it("is honest about an attempt nobody has paid yet", async () => {
    const seeded = await harness.seededInvoice();
    const attempt = await quoteAttempt(seeded.publicId);
    const token = String(attempt.receiptUrl).split("/").pop() ?? "";

    const body = await jsonOf(await receipt(String(attempt.id), token));

    expect(body).toMatchObject({ status: "awaiting_deposit", paidAt: null });
    expect(body.depositTxs).toEqual([]);
    expect(body.deliveryTxs).toEqual([]);
  });
});
