import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Roadmap: S4.6 (#108) · a `/receipt/<token>` link copied short must open the same receipt the
// full link does — the token is unique to one attempt, so it needs no `?attempt=` to be resolved.
import { GET } from "./route";
import { GET as BY_ATTEMPT } from "./[attemptId]/route";
import { POST as QUOTE } from "../pay/[publicId]/quote/route";
import { GET as STATUS } from "../pay/[publicId]/status/route";
import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import {
  APP_ORIGIN,
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

function byToken(token?: string): Promise<Response> {
  const query = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
  return GET(apiRequest(`/api/receipts${query}`));
}

function tokenOf(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
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

/** Open a quote, let 1Click report SUCCESS, and return the link's token and attempt id. */
async function paidReceipt() {
  const seeded = await harness.seededInvoice({ destinationAddress: "seller-payout.testnet" });
  const attempt = await quoteAttempt(seeded.publicId);
  harness.oneClick.statuses(statusesFixture.SUCCESS);
  await STATUS(apiRequest(`/api/pay/${seeded.publicId}/status`), {
    params: Promise.resolve({ publicId: seeded.publicId }),
  });
  const attemptId = String(attempt.id);
  const token = tokenOf(String(attempt.receiptUrl));
  return { ...seeded, attemptId, token };
}

describe("GET /api/receipts?token=", () => {
  it("resolves a bare link to the attempt its token names", async () => {
    const { attemptId, token } = await paidReceipt();
    const response = await byToken(token);
    const body = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ attemptId, status: "success", oneclickStatus: "SUCCESS" });
    expect(body.receiptUrl).toBe(`${APP_ORIGIN}/receipt/${token}?attempt=${attemptId}`);
  });

  it("answers identically to the id-keyed route for the same link", async () => {
    const { attemptId, token } = await paidReceipt();
    const [tokenOnly, withId] = await Promise.all([
      jsonOf(await byToken(token)),
      jsonOf(
        await BY_ATTEMPT(apiRequest(`/api/receipts/${attemptId}?token=${token}`), {
          params: Promise.resolve({ attemptId }),
        }),
      ),
    ]);
    expect(tokenOnly).toEqual(withId);
  });

  it("refuses a request with no token, and one too short to be a token", async () => {
    const missing = await byToken();
    const short = await byToken("abc");

    expect(missing.status).toBe(400);
    expect((await errorOf(missing)).code).toBe("bad_request");
    expect(short.status).toBe(400);
  });

  it("answers 404 for a token that names no attempt, so links cannot be enumerated", async () => {
    const unknown = await byToken("0123456789abcdefghij-not-a-token");
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).message).toBe("No such receipt.");
  });

  it("is honest about an attempt nobody has paid yet", async () => {
    const seeded = await harness.seededInvoice();
    const attempt = await quoteAttempt(seeded.publicId);
    const token = tokenOf(String(attempt.receiptUrl));

    const body = await jsonOf(await byToken(token));

    expect(body).toMatchObject({ status: "awaiting_deposit", paidAt: null });
    expect(body.depositTxs).toEqual([]);
    expect(body.deliveryTxs).toEqual([]);
  });

  it("keeps the payer's refund address and the seller's payout out of the document", async () => {
    const { token } = await paidReceipt();
    const text = await (await byToken(token)).text();

    expect(text).not.toContain("payer.testnet");
    expect(text).not.toContain("seller-payout.testnet");
    expect(text).not.toContain("refundTo");
    expect(text).not.toContain("payoutDestinationId");
  });
});
