/**
 * The demo seed: the story it writes, and the guarantee that it is a story the app could have lived.
 * Roadmap: S6.2, S6.8 · Spec: PRD FR-22, ARCHITECTURE.md §3.3, §7
 *
 * The assertions that matter are not "ten rows appeared". They are:
 * - every status a dashboard can show is present, so a judge never has to manufacture one;
 * - every seeded attempt carries a quote the vendor's own verifier accepts under the demo key, which
 *   is only possible because the seed wrote it through `createPaymentAttempt`;
 * - `refunded` and `failed` are *absent* from the invoice list, because §3.3 puts those invoices back
 *   to `open` — a seed that asserted them would be teaching the demo a status the app cannot reach;
 * - clearing is scoped to demo accounts, so a real sign-in in the same database survives a reset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  DEMO_ACCOUNT_ID,
  DEMO_PAYOUT_ADDRESS,
  DEMO_PAYOUT_ADDRESS_OLD,
  clearDemoData,
  demoStatuses,
  findDemoUser,
  seedDemo,
} from "./seed-demo";
import { demoSeedOptions } from "../server/adapters";
import { DEMO_MANAGER_PUBLIC_KEY } from "../oneclick/demo";
import { quoteResponseSchema, verifyQuoteSignature } from "../oneclick/quote";
import { listAttemptsForInvoice } from "./queries/paymentAttempts";
import { createInvoice } from "./queries/invoices";
import { listDestinations, setActiveDestination } from "./queries/payoutDestinations";
import { openTestDatabase, seedUser } from "./__fixtures__/testdb";
import { invoices, payoutDestinations } from "./schema";
import type { PgliteDb } from "./client";
import type { DemoSeed } from "./seed-demo";
import type { InvoiceStatus } from "../core/status";

let connected: Awaited<ReturnType<typeof openTestDatabase>>;
let db: PgliteDb;
let seed: DemoSeed;
/** A real (non-demo) account in the same database, to prove `clearDemoData` is scoped. */
let realUserId: string;

const NOW = Date.parse("2026-11-05T09:00:00Z");

beforeAll(async () => {
  connected = await openTestDatabase();
  db = connected.db;
  const real = await seedUser(db, "real.freelancer.near");
  realUserId = real.id;
  seed = await seedDemo(db, demoSeedOptions(() => NOW));
});

afterAll(async () => {
  await connected.close();
});

describe("seedDemo — the story", () => {
  it("writes one freelancer, and signs the demo session in as them", async () => {
    expect(seed.invoices).toHaveLength(10);
    const user = await findDemoUser(db);
    expect(user?.nearAccountId).toBe(DEMO_ACCOUNT_ID);
    expect(user?.isDemo).toBe(true);
  });

  it("covers every status a dashboard can show", () => {
    const statuses = new Set<InvoiceStatus>(demoStatuses(seed));
    expect([...statuses].sort()).toEqual(
      [
        "cancelled",
        "draft",
        "open",
        "overpaid",
        "paid",
        "paid_after_cancel",
        "payment_detected",
        "processing",
        "underpaid",
      ].sort(),
    );
  });

  it("never claims a refunded or failed invoice, because §3.3 sends those back to open", () => {
    const statuses = demoStatuses(seed);
    expect(statuses).not.toContain("refunded");
    expect(statuses).not.toContain("failed");

    // The refund is on the attempt, which is where the invoice detail page shows it.
    const refunded = seed.invoices.find((invoice) => invoice.clientName === "Ostro Games" && invoice.status === "open");
    expect(refunded).toBeDefined();
  });

  it("stamps paidAt on a settled invoice, including one paid after it was cancelled", async () => {
    const settled = seed.invoices.filter((invoice) =>
      ["paid", "overpaid", "paid_after_cancel"].includes(invoice.status),
    );
    expect(settled.length).toBeGreaterThanOrEqual(3);

    for (const invoice of settled) {
      const rows = await db.select().from(invoices).where(eq(invoices.id, invoice.invoiceId));
      const row = rows[0];
      expect(row).toBeDefined();
      // The seed picks a settlement day per story, so the invariant is the ordering, not the date:
      // paid after it was issued, and never in the future relative to the frozen clock.
      expect(row!.paidAt).not.toBeNull();
      expect(row!.paidAt!.getTime()).toBeGreaterThanOrEqual(row!.createdAt.getTime());
      expect(row!.paidAt!.getTime()).toBeLessThanOrEqual(NOW);
    }
  });

  it("keeps a payout history, so settings has a change to show", async () => {
    const destinations = await listDestinations(db, seed.userId);
    expect(destinations).toHaveLength(2);

    const current = destinations.find((row) => row.address === DEMO_PAYOUT_ADDRESS);
    const previous = destinations.find((row) => row.address === DEMO_PAYOUT_ADDRESS_OLD);
    expect(current?.active).toBe(true);
    expect(current?.deactivatedAt).toBeNull();
    expect(previous?.active).toBe(false);
    expect(previous?.deactivatedAt).not.toBeNull();
    // The old address is what the payout log shows as changed *from*.
    expect(previous?.createdAt.getTime()).toBeLessThan(current!.createdAt.getTime());
  });
});

describe("seedDemo — the attempts it writes", () => {
  it("gives every attempt a quote the vendor's verifier accepts under the demo key", async () => {
    const attempts = (
      await Promise.all(seed.invoices.map((invoice) => listAttemptsForInvoice(db, invoice.invoiceId)))
    ).flat();
    expect(attempts.length).toBeGreaterThanOrEqual(8);

    for (const attempt of attempts) {
      const response = quoteResponseSchema.parse(attempt.quoteRaw);
      expect(verifyQuoteSignature(response, DEMO_MANAGER_PUBLIC_KEY)).toBe(true);
      expect(attempt.depositAddress.startsWith("settle-demo-")).toBe(true);
      expect(attempt.receiptToken).not.toBeNull();
      // The fixed side of an EXACT_OUTPUT quote is the invoice total.
      const invoice = seed.invoices.find((row) => row.invoiceId === attempt.invoiceId);
      expect(attempt.amountOut).toBe(invoice?.total);
    }
  });

  it("leaves a live attempt open, so the pay page has something to watch", async () => {
    const live = seed.invoices.filter((invoice) =>
      ["payment_detected", "processing"].includes(invoice.status),
    );
    expect(live).toHaveLength(2);

    for (const invoice of live) {
      const attempts = await listAttemptsForInvoice(db, invoice.invoiceId);
      expect(attempts[0]?.updatedAt.toISOString()).toBe(new Date(NOW).toISOString());
    }
  });
});

describe("clearDemoData", () => {
  it("removes the story and leaves a real account alone", async () => {
    // A real destination and invoice written *before* the clear, so "scoped to demo rows" is an
    // assertion about surviving data rather than about a table that happened to be empty.
    const realDestination = await setActiveDestination(db, {
      userId: realUserId,
      assetId: "nep141:usdc",
      chain: "near",
      address: "real.freelancer.near",
    });
    const realInvoice = await createInvoice(db, {
      userId: realUserId,
      clientName: "A Real Client",
      lines: [{ description: "Work", quantity: "1", unitPrice: "1000000" }],
      status: "open",
    });

    await clearDemoData(db);

    expect(await findDemoUser(db)).toBeNull();
    const demoInvoices = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.userId, seed.userId));
    expect(demoInvoices).toHaveLength(0);
    const demoDestinations = await db
      .select({ id: payoutDestinations.id })
      .from(payoutDestinations)
      .where(eq(payoutDestinations.userId, seed.userId));
    expect(demoDestinations).toHaveLength(0);

    const stillThere = await db.select().from(payoutDestinations).where(eq(payoutDestinations.id, realDestination.id));
    expect(stillThere).toHaveLength(1);
    const realStillOpen = await db.select().from(invoices).where(eq(invoices.id, realInvoice.id));
    expect(realStillOpen[0]?.status).toBe("open");
  });

  it("seeds the same story twice, so a restart mid-demo is not additive", async () => {
    const again = await seedDemo(db, demoSeedOptions(() => NOW));
    expect(again.invoices).toHaveLength(10);
    expect(demoStatuses(again)).toEqual(demoStatuses(seed));
  });
});
