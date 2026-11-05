import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.3, S3.8 · invoice create / list / detail / cancel, including the 404-not-403 rule.
import { GET as LIST, POST as CREATE } from "./route";
import { GET as DETAIL } from "./[id]/route";
import { POST as CANCEL } from "./[id]/cancel/route";
import { invoices } from "@/lib/db/schema";
import {
  APP_ORIGIN,
  apiRequest,
  arrayOf,
  createRouteHarness,
  errorOf,
  issuesOf,
  jsonOf,
  type RouteHarness,
  type SeededInvoice,
  type Signer,
} from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

beforeAll(async () => {
  harness = await createRouteHarness();
});

afterAll(async () => {
  await harness?.close();
});

const twoLines = {
  clientName: "Client Co",
  items: [
    { description: "Design, sprint 12", quantity: "1", unitPrice: "5000000" },
    { description: "Rush surcharge", quantity: "1", unitPrice: "3" },
  ],
};

/** `5_000_000 + 3` base units, shown at the payout asset's 6 decimals. */
const TOTAL = "5000003";

/** A signed-in seller with no invoices yet, so the numbering starts at `INV-0001`. */
async function seller(): Promise<{ signer: Signer; cookie: string }> {
  const signer = harness.newSigner();
  return { signer, cookie: await harness.cookieFor(signer) };
}

function create(cookie: string, body: unknown = twoLines): Promise<Response> {
  return CREATE(apiRequest("/api/invoices", { method: "POST", body, cookie }));
}

async function listInvoices(cookie: string, query = ""): Promise<Record<string, unknown>[]> {
  return arrayOf(await LIST(apiRequest(`/api/invoices${query}`, { cookie })));
}

function detail(cookie: string, id: string): Promise<Response> {
  return DETAIL(apiRequest(`/api/invoices/${id}`, { cookie }), { params: Promise.resolve({ id }) });
}

function cancel(cookie: string, id: string): Promise<Response> {
  return CANCEL(apiRequest(`/api/invoices/${id}/cancel`, { method: "POST", cookie }), {
    params: Promise.resolve({ id }),
  });
}

async function markAsPaid(seed: SeededInvoice): Promise<void> {
  await harness.db
    .update(invoices)
    .set({ status: "paid", paidAt: new Date(harness.deps.now()) })
    .where(eq(invoices.id, seed.invoiceId));
}

describe("POST /api/invoices", () => {
  it("requires a session", async () => {
    expect((await create("settle_session=YWJj.ZGVm")).status).toBe(401);
    expect((await CREATE(apiRequest("/api/invoices", { method: "POST", body: twoLines }))).status).toBe(401);
  });

  it("opens the invoice with its total, lines and pay link", async () => {
    const { cookie } = await seller();
    const response = await create(cookie);
    const body = await jsonOf(response);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      number: "INV-0001",
      status: "open",
      clientName: "Client Co",
      lines: [
        { description: "Design, sprint 12", quantity: "1", unitPrice: "5000000", amount: "5000000", position: 0 },
        { description: "Rush surcharge", quantity: "1", unitPrice: "3", amount: "3", position: 1 },
      ],
    });
    expect(body.total).toMatchObject({ baseUnits: TOTAL, amount: "5.000003", symbol: "USDC", decimals: 6 });
    expect(body.payUrl).toBe(`${APP_ORIGIN}/pay/${body.publicId}`);
  });

  it("counts up for one seller and restarts for the next", async () => {
    const mine = await seller();
    const first = await jsonOf(await create(mine.cookie));
    const second = await jsonOf(await create(mine.cookie));
    const other = await jsonOf(await create((await seller()).cookie));

    expect(first.number).toBe("INV-0001");
    expect(second.number).toBe("INV-0002");
    expect(other.number).toBe("INV-0001");
  });

  it("keeps optional fields null when they are not sent", async () => {
    const body = await jsonOf(await create((await seller()).cookie));

    expect(body).toMatchObject({
      clientEmail: null,
      memo: null,
      dueDate: null,
      paidAt: null,
      cancelledAt: null,
    });
  });

  it("refuses an invoice with no lines", async () => {
    const response = await create((await seller()).cookie, { clientName: "No lines", items: [] });
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(issuesOf(error)).toContainEqual({
      path: "items",
      message: expect.stringContaining("at least 1"),
    });
  });

  it("refuses a fractional base-unit price and names the line", async () => {
    const response = await create((await seller()).cookie, {
      clientName: "Bad price",
      items: [
        { description: "Fine", quantity: "1", unitPrice: "100" },
        { description: "Wrong", quantity: "1", unitPrice: "1.5" },
      ],
    });

    expect(response.status).toBe(400);
    expect(issuesOf(await errorOf(response))).toContainEqual({
      path: "items.1.unitPrice",
      message: "Amount must be a non-negative integer string",
    });
  });

  it("refuses a quantity with more than 4 decimals", async () => {
    const response = await create((await seller()).cookie, {
      clientName: "Bad quantity",
      items: [{ description: "Hours", quantity: "1.23456", unitPrice: "100" }],
    });

    expect(response.status).toBe(400);
    expect(issuesOf(await errorOf(response))[0]?.path).toBe("items.0.quantity");
  });

  it("refuses a malformed email", async () => {
    const response = await create((await seller()).cookie, { ...twoLines, clientEmail: "not-an-email" });

    expect(response.status).toBe(400);
    expect(issuesOf(await errorOf(response))[0]?.path).toBe("clientEmail");
  });
});

describe("GET /api/invoices", () => {
  it("requires a session", async () => {
    expect((await LIST(apiRequest("/api/invoices"))).status).toBe(401);
  });

  it("lists this user's invoices and nobody else's", async () => {
    const mine = await seller();
    const theirs = await seller();
    const mineInvoice = await jsonOf(await create(mine.cookie));
    await create(theirs.cookie);

    const rows = await listInvoices(mine.cookie);

    expect(rows.map((row) => row.publicId)).toEqual([mineInvoice.publicId]);
    expect(rows[0]).toMatchObject({ status: "open", clientName: "Client Co" });
  });

  it("filters by status", async () => {
    const { cookie, invoiceId, publicId } = await harness.seededInvoice();
    await cancel(cookie, invoiceId);

    const cancelled = await listInvoices(cookie, "?status=cancelled");
    const open = await listInvoices(cookie, "?status=open");

    expect(cancelled.map((row) => row.publicId)).toEqual([publicId]);
    expect(open).toEqual([]);
  });

  it("applies the limit", async () => {
    const { cookie } = await seller();
    await create(cookie);
    await create(cookie);

    expect(await listInvoices(cookie, "?limit=1")).toHaveLength(1);
  });

  it("refuses a status that is not one of ours", async () => {
    const { cookie } = await seller();
    const response = await LIST(apiRequest("/api/invoices?status=nope", { cookie }));

    expect(response.status).toBe(400);
    expect(issuesOf(await errorOf(response))[0]?.path).toBe("status");
  });

  it("refuses a limit above the page size", async () => {
    const { cookie } = await seller();

    expect((await LIST(apiRequest("/api/invoices?limit=500", { cookie }))).status).toBe(400);
  });
});

describe("GET /api/invoices/:id", () => {
  it("requires a session", async () => {
    const seed = await harness.seededInvoice();

    expect((await detail("settle_session=YWJj.ZGVm", seed.invoiceId)).status).toBe(401);
  });

  it("returns the invoice with its payment attempts", async () => {
    const { cookie, invoiceId, publicId, total } = await harness.seededInvoice();
    const body = await jsonOf(await detail(cookie, invoiceId));

    expect(body).toMatchObject({ id: invoiceId, publicId, total: { baseUnits: total }, attempts: [] });
  });

  it("answers 404 for another user's invoice", async () => {
    const theirs = await harness.seededInvoice();
    const mine = await harness.seededInvoice();

    const response = await detail(mine.cookie, theirs.invoiceId);

    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
  });

  it("answers 404 for an id that cannot be an invoice", async () => {
    const { cookie } = await harness.seededInvoice();

    expect((await detail(cookie, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await detail(cookie, "hello-world")).status).toBe(404);
  });
});

describe("POST /api/invoices/:id/cancel", () => {
  it("requires a session", async () => {
    const seed = await harness.seededInvoice();

    expect((await cancel("settle_session=YWJj.ZGVm", seed.invoiceId)).status).toBe(401);
  });

  it("cancels an open invoice with a timestamp, not a deletion", async () => {
    const { cookie, invoiceId, publicId } = await harness.seededInvoice();
    const response = await cancel(cookie, invoiceId);
    const body = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: invoiceId, publicId, status: "cancelled" });
    expect(body.cancelledAt).toBe(new Date(harness.deps.now()).toISOString());
    expect(await jsonOf(await detail(cookie, invoiceId))).toMatchObject({ status: "cancelled" });
  });

  it("is idempotent: cancelling twice says the same thing", async () => {
    const { cookie, invoiceId } = await harness.seededInvoice();
    const first = await jsonOf(await cancel(cookie, invoiceId));
    const second = await jsonOf(await cancel(cookie, invoiceId));

    expect(second).toEqual(first);
  });

  it("refuses to cancel an invoice the client already paid", async () => {
    const paid = await harness.seededInvoice();
    await markAsPaid(paid);

    const response = await cancel(paid.cookie, paid.invoiceId);
    const error = await errorOf(response);

    expect(response.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("already paid");
  });

  it("answers 404 for another user's invoice", async () => {
    const theirs = await harness.seededInvoice();
    const mine = await harness.seededInvoice();

    expect((await cancel(mine.cookie, theirs.invoiceId)).status).toBe(404);
    expect((await cancel(mine.cookie, "not-a-uuid")).status).toBe(404);
  });
});
