import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.7, S3.8 · the accountant's export: one row per attempt, exact units, and no demo data.
import { GET } from "./route";
import { POST as CREATE_INVOICE } from "../invoices/route";
import { users } from "@/lib/db/schema";
import { USDC_ON_NEAR, apiRequest, createRouteHarness, jsonOf, type RouteHarness } from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

beforeAll(async () => {
  harness = await createRouteHarness();
});

afterAll(async () => {
  await harness?.close();
});

async function csv(cookie: string): Promise<Response> {
  return GET(apiRequest("/api/export.csv", { cookie }));
}

/** The seller's own rows, split the way a spreadsheet reads them. */
async function rows(cookie: string): Promise<{ header: string[]; body: string[] }> {
  const text = await (await csv(cookie)).text();
  const [headerLine = "", ...body] = text.split("\r\n");
  return { header: headerLine.split(","), body: body.filter((line) => line.length > 0) };
}

function column(header: string[], name: string): number {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`no ${name} column in ${header.join(",")}`);
  return index;
}

describe("GET /api/export.csv", () => {
  it("requires a session", async () => {
    expect((await GET(apiRequest("/api/export.csv"))).status).toBe(401);
    expect((await csv("settle_session=YWJj.ZGVm")).status).toBe(401);
  });

  it("is CSV, attached as a file dated from the frozen clock, and never cached", async () => {
    const { cookie } = await harness.seededInvoice();
    const response = await csv(cookie);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="settle-ledger-2026-11-05.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("writes one row per invoice, keyed by the header columns", async () => {
    const { cookie, publicId } = await harness.seededInvoice();
    const { header, body } = await rows(cookie);

    expect(header[0]).toBe("invoice_number");
    expect(body).toHaveLength(1);

    const row = body[0]?.split(",");
    expect(row?.[column(header, "invoice_number")]).toBe("INV-0001");
    expect(row?.[column(header, "invoice_status")]).toBe("open");
    expect(row?.[column(header, "payout_asset")]).toBe(USDC_ON_NEAR);
    expect(row?.[column(header, "invoice_total_base_units")]).toBe("5000003");
    expect(row?.[column(header, "invoice_total")]).toBe("5.000003");
    expect(row?.[column(header, "pay_url")]).toBe(`http://settle.test/pay/${publicId}`);
    // no attempt yet, so nothing is filled in on the payment side
    expect(row?.[column(header, "attempt_id")]).toBe("");
    expect(row?.[column(header, "deposit_address")]).toBe("");
  });

  it("quotes a client name that contains a comma", async () => {
    const { cookie } = await harness.seededInvoice();
    await CREATE_INVOICE(
      apiRequest("/api/invoices", {
        method: "POST",
        cookie,
        body: { clientName: 'Acme, "Big" Corp', items: [{ description: "Work", quantity: "1", unitPrice: "100" }] },
      }),
    );

    const { body } = await rows(cookie);
    const line = body.find((l) => l.includes("Acme"));

    expect(line).toContain('"Acme, ""Big"" Corp"');
  });

  it("exports only this seller's invoices", async () => {
    const mine = await harness.seededInvoice();
    const theirs = await harness.seededInvoice();

    const { body: myRows } = await rows(mine.cookie);
    const { body: theirRows } = await rows(theirs.cookie);

    expect(myRows).toHaveLength(1);
    expect(myRows.join("\n")).toContain(mine.publicId);
    expect(myRows.join("\n")).not.toContain(theirs.publicId);
    expect(theirRows.join("\n")).toContain(theirs.publicId);
    expect(theirRows.join("\n")).not.toContain(mine.publicId);
  });

  it("refuses a demo account, whose rows are seeded fiction", async () => {
    const seeded = await harness.seededInvoice();
    await harness.db.update(users).set({ isDemo: true }).where(eq(users.id, seeded.userId));
    const cookie = await harness.cookieFor(seeded.signer);

    const response = await csv(cookie);

    expect(response.status).toBe(403);
    expect((await jsonOf(response)).error).toMatchObject({ code: "forbidden" });
  });
});
