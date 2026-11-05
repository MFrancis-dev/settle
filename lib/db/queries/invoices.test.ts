/**
 * S2.9 — `invoices` + `invoice_items` queries against a real Postgres (in-memory PGlite).
 * Spec: ARCHITECTURE.md §4, §5 · SD-6 (per-user invoice numbers)
 *
 * The two things that would be silent disasters are what these tests aim at: a total that does
 * not equal the sum of the stored lines, and two invoices for one user sharing a number.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LINES, openTestDatabase, seedUser } from "../__fixtures__/testdb";
import type { ConnectedDatabase, PgliteDb } from "../client";
import {
  cancelInvoice,
  createInvoice,
  getInvoiceById,
  getInvoiceByPublicId,
  listInvoicesForUser,
  setInvoiceStatus,
} from "./invoices";

let connected: ConnectedDatabase<PgliteDb>;
let db: PgliteDb;

beforeAll(async () => {
  connected = await openTestDatabase();
  db = connected.db;
});

afterAll(async () => {
  await connected.close();
});

const wait = () => new Promise((resolve) => setTimeout(resolve, 2));

describe("createInvoice", () => {
  it("stores the total as the sum of the rounded lines, exactly", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client Co",
      lines: LINES,
    });

    // 1.5 × 3.333333 rounds to 5000000, plus 3 × 1: a float anywhere in here would miss.
    expect(invoice.total).toBe("5000003");
    expect(invoice.lines.map((line) => line.amount)).toEqual(["5000000", "3"]);
    expect(invoice.lines.map((line) => line.description)).toEqual([
      "Design, sprint 12",
      "Rush surcharge",
    ]);
    expect(BigInt(invoice.total)).toBe(
      invoice.lines.reduce((sum, line) => sum + BigInt(line.amount), 0n),
    );
  });

  it("keeps line order and the decimal quantity as written", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client",
      lines: LINES,
    });
    expect(invoice.lines.map((line) => line.position)).toEqual([0, 1]);
    // `numeric(18,4)` stores "3.0000"; a line must come back as it was written.
    expect(invoice.lines.map((line) => line.quantity)).toEqual(["1.5", "3"]);
  });

  it("numbers invoices INV-0001, INV-0002 for one user", async () => {
    const user = await seedUser(db);
    const first = await createInvoice(db, { userId: user.id, clientName: "A", lines: LINES });
    const second = await createInvoice(db, { userId: user.id, clientName: "B", lines: LINES });

    expect([first.number, second.number]).toEqual(["INV-0001", "INV-0002"]);
  });

  it("starts each user's numbering at INV-0001", async () => {
    const a = await seedUser(db);
    const b = await seedUser(db);
    await createInvoice(db, { userId: a.id, clientName: "A", lines: LINES });
    await createInvoice(db, { userId: a.id, clientName: "A", lines: LINES });
    const theirs = await createInvoice(db, { userId: b.id, clientName: "B", lines: LINES });
    expect(theirs.number).toBe("INV-0001");
  });

  it("gives two concurrent creates different numbers", async () => {
    // Both read the same "next number" here; the unique index decides and the loser retries.
    const user = await seedUser(db);
    const [one, two] = await Promise.all([
      createInvoice(db, { userId: user.id, clientName: "Race 1", lines: LINES }),
      createInvoice(db, { userId: user.id, clientName: "Race 2", lines: LINES }),
    ]);

    expect(new Set([one.number, two.number])).toEqual(new Set(["INV-0001", "INV-0002"]));
    expect(await listInvoicesForUser(db, user.id)).toHaveLength(2);
  });

  it("mints a public id that is url-safe and stable to look up", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client",
      lines: LINES,
    });

    expect(invoice.publicId).toMatch(/^[0-9a-z]{16}$/);
    expect((await getInvoiceByPublicId(db, invoice.publicId))?.id).toBe(invoice.id);
    expect(await getInvoiceByPublicId(db, "nosuchid")).toBeNull();
  });

  it("stores the optional fields, and nulls when they are absent", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client Co",
      clientEmail: "billing@client.test",
      memo: "Fixed price, USDC on NEAR",
      dueDate: "2026-11-30",
      lines: LINES,
    });

    expect(invoice).toMatchObject({
      clientEmail: "billing@client.test",
      memo: "Fixed price, USDC on NEAR",
      dueDate: "2026-11-30",
      status: "draft",
    });

    const bare = await createInvoice(db, { userId: user.id, clientName: "Client", lines: LINES });
    expect(bare.clientEmail).toBeNull();
    expect(bare.dueDate).toBeNull();
  });

  it("refuses to store an invoice with no lines", async () => {
    const user = await seedUser(db);
    await expect(
      createInvoice(db, { userId: user.id, clientName: "Empty", lines: [] }),
    ).rejects.toThrow();
  });

  it("rejects an invoice for a user that does not exist", async () => {
    // The foreign key is the only thing standing between a typo and an unreachable invoice.
    await expect(
      createInvoice(db, {
        userId: "00000000-0000-4000-8000-000000000000",
        clientName: "Ghost",
        lines: LINES,
      }),
    ).rejects.toThrow();
  });
});

describe("listing", () => {
  it("filters by status and caps the page", async () => {
    const user = await seedUser(db);
    await createInvoice(db, { userId: user.id, clientName: "Draft", lines: LINES });
    await wait();
    const open = await createInvoice(db, { userId: user.id, clientName: "Open", lines: LINES });
    await setInvoiceStatus(db, { invoiceId: open.id, status: "open" });
    await wait();
    const paid = await createInvoice(db, { userId: user.id, clientName: "Paid", lines: LINES });
    await setInvoiceStatus(db, { invoiceId: paid.id, status: "paid" });

    const statuses = await listInvoicesForUser(db, user.id, { statuses: ["paid"] });
    expect(statuses.map((invoice) => invoice.clientName)).toEqual(["Paid"]);

    const newestFirst = await listInvoicesForUser(db, user.id);
    expect(newestFirst.map((invoice) => invoice.clientName)).toEqual(["Paid", "Open", "Draft"]);

    expect(await listInvoicesForUser(db, user.id, { limit: 1 })).toHaveLength(1);
    expect(await listInvoicesForUser(db, (await seedUser(db)).id)).toEqual([]);
  });

  it("does not leak another user's invoice through a lookup by id", async () => {
    const owner = await seedUser(db);
    const invoice = await createInvoice(db, { userId: owner.id, clientName: "Mine", lines: LINES });
    const stranger = await seedUser(db);

    expect((await getInvoiceById(db, invoice.id))?.userId).toBe(owner.id);
    // Ownership is the API's job, but the row must stay attributable to exactly one user.
    expect(await listInvoicesForUser(db, stranger.id)).toEqual([]);
  });
});

describe("status writes", () => {
  it("stamps paidAt only when the money arrives", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client",
      lines: LINES,
    });
    expect(invoice.paidAt).toBeNull();

    const sent = await setInvoiceStatus(db, { invoiceId: invoice.id, status: "open" });
    expect(sent?.paidAt).toBeNull();

    const at = new Date("2026-11-06T10:00:00Z");
    const paid = await setInvoiceStatus(db, { invoiceId: invoice.id, status: "paid", at });
    expect(paid).toMatchObject({ status: "paid" });
    expect(paid?.paidAt?.toISOString()).toBe(at.toISOString());
  });

  it("never overwrites the moment the payment landed", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client",
      lines: LINES,
    });
    const paidAt = new Date("2026-11-06T10:00:00Z");
    await setInvoiceStatus(db, { invoiceId: invoice.id, status: "paid", at: paidAt });

    // A later poll that reads a stale underpaid row must not move the receipt date.
    const refreshed = await setInvoiceStatus(db, {
      invoiceId: invoice.id,
      status: "underpaid",
      at: new Date("2026-11-06T11:00:00Z"),
    });
    expect(refreshed?.status).toBe("underpaid");
    expect(refreshed?.paidAt?.toISOString()).toBe(paidAt.toISOString());
  });

  it("cancels with a timestamp instead of deleting", async () => {
    const user = await seedUser(db);
    const invoice = await createInvoice(db, {
      userId: user.id,
      clientName: "Client",
      lines: LINES,
    });
    const at = new Date("2026-11-07T09:00:00Z");

    const cancelled = await cancelInvoice(db, invoice.id, at);
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(cancelled?.cancelledAt?.toISOString()).toBe(at.toISOString());
    // Still readable, because a payment that arrives after a cancel has to be reconcilable.
    expect((await getInvoiceById(db, invoice.id))?.id).toBe(invoice.id);
  });

  it("returns null for an invoice that is not there", async () => {
    expect(
      await setInvoiceStatus(db, {
        invoiceId: "00000000-0000-4000-8000-000000000000",
        status: "paid",
      }),
    ).toBeNull();
    expect(await cancelInvoice(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getInvoiceById(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
