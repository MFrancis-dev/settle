/**
 * S5.2 — `pollPayments`: one tick, real database, scripted 1Click.
 * Spec: ARCHITECTURE.md §3.4 · AGENTS.md §8 (no mocks of Settle's own code)
 *
 * A tick is the whole unit of work, so the tests drive one tick and read the tables afterwards — the
 * same harness the route tests use, which means the attempt was opened by the real quote route and
 * the status comes from a fixture the vendor's own verifier accepts.
 *
 * The harness is fresh per test on purpose: a tick's counts are global (every live attempt in the
 * database), so a test that asserts `checked: 1` must be the only one that opened an attempt.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { invoices, paymentAttempts } from "@/lib/db/schema";
import { findAttemptById, recordAttemptStatus } from "@/lib/db/queries/paymentAttempts";
import {
  apiRequest,
  createRouteHarness,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";
import { POST as QUOTE } from "@/app/api/pay/[publicId]/quote/route";
import { pollPayments, type WorkerDeps } from "./pollPayments";

let harness: RouteHarness;
let logs: string[];
let deps: WorkerDeps;

beforeEach(async () => {
  harness = await createRouteHarness();
  logs = [];
  deps = {
    db: harness.db,
    oneClick: harness.deps.oneClick,
    now: harness.deps.now,
    log: (message) => logs.push(message),
  };
});

afterEach(async () => {
  await harness.close();
});

const WNEAR = "nep141:wrap.near";

/** A real quote through the real route, so the attempt is one a client could actually have been given. */
async function openAttempt(publicId: string) {
  const body = await jsonOf(
    await QUOTE(
      apiRequest(`/api/pay/${publicId}/quote`, {
        body: { originAsset: WNEAR, refundTo: "payer.testnet", dry: false },
      }),
      { params: Promise.resolve({ publicId }) },
    ),
  );
  const attempt = body.attempt as Record<string, unknown>;
  if (!attempt?.id) throw new Error("the quote route returned no attempt");
  return { id: String(attempt.id), depositAddress: String(attempt.depositAddress) };
}

async function storedAttempt(id: string) {
  return findAttemptById(harness.db, id);
}

async function storedInvoice(invoiceId: string) {
  const [row] = await harness.db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!row) throw new Error("invoice vanished");
  return row;
}

describe("pollPayments — one tick", () => {
  it("does nothing at all when there is no live attempt", async () => {
    await harness.seededInvoice();

    expect(await pollPayments(deps)).toEqual({
      checked: 0,
      advanced: 0,
      unchanged: 0,
      silent: 0,
      failed: 0,
    });
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/status")).toEqual([]);
  });

  it("pays the invoice when 1Click reports SUCCESS", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    const tick = await pollPayments(deps);

    expect(tick).toMatchObject({ checked: 1, advanced: 1, silent: 0, failed: 0 });
    expect(await storedAttempt(attempt.id)).toMatchObject({
      status: "success",
      oneclickStatus: "SUCCESS",
    });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "paid" });
  });

  it("asks about the deposit address the client was given, not the invoice", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);

    await pollPayments(deps);

    const call = harness.oneClick.calls.find((entry) => entry.path === "/v0/status");
    expect(call?.query?.depositAddress).toBe(attempt.depositAddress);
    expect(typeof call?.query?.depositMemo).toBe("string");
  });

  it("follows the money across ticks: detected, then processing, then paid", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(
      statusesFixture.KNOWN_DEPOSIT_TX,
      statusesFixture.PROCESSING,
      statusesFixture.SUCCESS,
    );

    expect(await pollPayments(deps)).toMatchObject({ advanced: 1 });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "payment_detected" });

    expect(await pollPayments(deps)).toMatchObject({ advanced: 1 });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "processing" });

    expect(await pollPayments(deps)).toMatchObject({ advanced: 1 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "success" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "paid" });
  });

  it("counts a repeat of the same status as unchanged, not as progress", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.PROCESSING);

    expect(await pollPayments(deps)).toMatchObject({ advanced: 1 });
    expect(await pollPayments(deps)).toMatchObject({ checked: 1, advanced: 0, unchanged: 1 });
  });

  it("records 'no signal yet' without writing, so a missing deposit is never a failed one", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    // Nothing queued: the stub answers 404 the way 1Click does for a deposit it has never seen.

    const tick = await pollPayments(deps);

    expect(tick).toMatchObject({ checked: 1, silent: 1, advanced: 0, failed: 0 });
    expect(await storedAttempt(attempt.id)).toMatchObject({
      status: "awaiting_deposit",
      oneclickStatus: null,
    });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "open" });
  });

  it("treats 1Click being down as 'no signal', and still polls the other attempts", async () => {
    const first = await harness.seededInvoice();
    const second = await harness.seededInvoice();
    const down = await openAttempt(first.publicId);
    const working = await openAttempt(second.publicId);

    harness.oneClick.failOnce("/v0/status", 500);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    const tick = await pollPayments(deps);

    // A 5xx is not a failure of the tick: the deposit may still land, so nothing is written and the
    // attempt stays live for the next poll. Confusing the two is how a payment gets reported as dead.
    expect(tick).toMatchObject({ checked: 2, silent: 1, advanced: 1, failed: 0 });
    expect(await storedAttempt(down.id)).toMatchObject({ status: "awaiting_deposit" });
    expect(await storedAttempt(working.id)).toMatchObject({ status: "success" });
    expect(await storedInvoice(second.invoiceId)).toMatchObject({ status: "paid" });
  });

  it("counts a stale upstream read as a failure, logs the attempt id only, and keeps going", async () => {
    const first = await harness.seededInvoice();
    const second = await harness.seededInvoice();
    const ahead = await openAttempt(first.publicId);
    const working = await openAttempt(second.publicId);
    // The attempt has already moved past `payment_detected`, so a late response for that status is an
    // illegal transition — `recordAttemptStatus` throws rather than walk a payment backwards.
    await recordAttemptStatus(harness.db, { attemptId: ahead.id, oneclickStatus: "PROCESSING" });

    harness.oneClick.statuses(statusesFixture.KNOWN_DEPOSIT_TX, statusesFixture.SUCCESS);

    const tick = await pollPayments(deps);

    expect(tick).toMatchObject({ checked: 2, failed: 1, advanced: 1 });
    expect(await storedAttempt(ahead.id)).toMatchObject({ status: "processing" });
    expect(await storedAttempt(working.id)).toMatchObject({ status: "success" });

    // S7.10 starts here: the failure names the row, and carries no address, no amount, no upstream body.
    const failure = logs.filter((line) => line.includes("pollPayments"));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain(ahead.id);
    expect(failure[0]).toContain("illegal attempt transition");
    expect(failure[0]).not.toContain(ahead.depositAddress);
    expect(failure[0]).not.toContain("payer.testnet");
  });

  it("stops polling an attempt that has settled", async () => {
    const { publicId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    await pollPayments(deps);
    harness.oneClick.reset();

    expect(await pollPayments(deps)).toMatchObject({ checked: 0 });
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/status")).toEqual([]);
  });

  it("polls every live attempt across invoices in one tick", async () => {
    const first = await harness.seededInvoice();
    const second = await harness.seededInvoice();
    await openAttempt(first.publicId);
    await openAttempt(second.publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    const tick = await pollPayments(deps);

    expect(tick).toMatchObject({ checked: 2, advanced: 2 });
    expect(await storedInvoice(first.invoiceId)).toMatchObject({ status: "paid" });
    expect(await storedInvoice(second.invoiceId)).toMatchObject({ status: "paid" });
  });

  it("honours the batch limit, so a backlog drains instead of bursting", async () => {
    const first = await harness.seededInvoice();
    const second = await harness.seededInvoice();
    await openAttempt(first.publicId);
    await openAttempt(second.publicId);
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);

    const tick = await pollPayments(deps, { limit: 1 });

    expect(tick).toMatchObject({ checked: 1 });
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/status")).toHaveLength(1);
  });

  it("surfaces a short deposit as underpaid, which is a verdict the client must act on", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.INCOMPLETE_DEPOSIT);

    expect(await pollPayments(deps)).toMatchObject({ advanced: 1 });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "underpaid" });
  });
});

describe("pollPayments — the table it reads", () => {
  it("leaves an attempt alone when the tick is told to look at none", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    expect(await pollPayments(deps, { limit: 0 })).toMatchObject({ checked: 0 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "awaiting_deposit" });
  });

  it("reads a live attempt that the pay page never polled", async () => {
    // The point of the worker: nobody has the pay page open, and the payment still completes.
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    await pollPayments(deps);

    const [row] = await harness.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attempt.id));
    expect(row).toMatchObject({ status: "success", deliveryTxHash: expect.any(String) });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "paid" });
  });
});
