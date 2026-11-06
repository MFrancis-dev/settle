import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.4, S3.8 · the public pay-page read: unguessable link, and no seller secrets (§6).
import { GET } from "./route";
import { POST as QUOTE } from "./quote/route";
import { invoices } from "@/lib/db/schema";
import {
  APP_ORIGIN,
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

afterAll(async () => {
  await harness?.close();
});

function pay(publicId: string): Promise<Response> {
  return GET(apiRequest(`/api/pay/${publicId}`), { params: Promise.resolve({ publicId }) });
}

describe("GET /api/pay/:publicId", () => {
  it("shows a client what they need and nothing else", async () => {
    const { publicId, signer } = await harness.seededInvoice({
      destinationAddress: "seller-payout.testnet",
    });
    const response = await pay(publicId);
    const body = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      publicId,
      number: "INV-0001",
      seller: signer.accountId,
      clientName: "Client Co",
      status: "open",
    });
    expect(body.total).toMatchObject({ assetId: USDC_ON_NEAR, baseUnits: "5000003", decimals: 6 });
    expect(body.payUrl).toBe(`${APP_ORIGIN}/pay/${publicId}`);
    expect(body.activeAttempt).toBeNull();
  });

  it("never reveals where the seller is paid out, or who they are", async () => {
    const { publicId, userId } = await harness.seededInvoice({
      destinationAddress: "seller-payout.testnet",
    });
    const text = await (await pay(publicId)).text();

    // §6: the pay page is a public URL. A leaked payout address turns a shared link into a
    // target for the "send it somewhere else" scam this app must make impossible.
    expect(text).not.toContain("seller-payout.testnet");
    expect(text).not.toContain(userId);
    expect(text).not.toContain("refundTo");
    expect(text).not.toContain("payoutDestinationId");
  });

  it("answers the same 404 for an unknown link as for a malformed one", async () => {
    const unknown = await pay("nosuchlink");
    const malformed = await pay("%20");

    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).message).toBe("No such payment link.");
    expect(malformed.status).toBe(404);
  });

  it("reports a cancelled invoice as cancelled instead of hiding it", async () => {
    const seeded = await harness.seededInvoice();
    await harness.db
      .update(invoices)
      .set({ status: "cancelled", cancelledAt: new Date(harness.deps.now()) })
      .where(eq(invoices.id, seeded.invoiceId));

    expect(await jsonOf(await pay(seeded.publicId))).toMatchObject({ status: "cancelled" });
  });

  it("carries the client's live attempt, including their own deposit address", async () => {
    const { publicId } = await harness.seededInvoice();
    const opened = await jsonOf(
      await QUOTE(
        apiRequest(`/api/pay/${publicId}/quote`, {
          body: { originAsset: "nep141:wrap.near", refundTo: "payer.testnet", dry: false },
        }),
        { params: Promise.resolve({ publicId }) },
      ),
    );
    const quoted = opened.attempt as Record<string, unknown>;

    const attempt = (await jsonOf(await pay(publicId))).activeAttempt as Record<string, unknown>;

    expect(attempt).toMatchObject({
      id: quoted.id,
      depositAddress: quoted.depositAddress,
      depositMemo: quoted.depositMemo,
      status: "awaiting_deposit",
    });
    expect(attempt.originAsset).toMatchObject({
      assetId: "nep141:wrap.near",
      symbol: "wNEAR",
      decimals: 24,
    });
    expect(attempt.payoutAsset).toMatchObject({ assetId: USDC_ON_NEAR, baseUnits: "5000003" });
  });
});
