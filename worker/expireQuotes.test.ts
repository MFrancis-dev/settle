/**
 * S5.3 — `expireQuotes`: one tick, real database, scripted 1Click.
 * Spec: ARCHITECTURE.md §3.4, §3.3
 *
 * The rule is "deadline passed **and no deposit**". Every test here advances the harness clock past
 * the quote's own deadline (30 minutes for a NEAR origin, `deadlineForOriginChain`) rather than
 * backdating a row, so what expires is a quote the app really issued.
 *
 * The cases that matter are the ones where expiring would be wrong: money that lands late, and a
 * service that is briefly unreachable. `expired` is terminal, so a wrong one cannot be undone.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { invoices } from "@/lib/db/schema";
import {
  findActiveAttemptForInvoice,
  findAttemptById,
  recordAttemptStatus,
} from "@/lib/db/queries/paymentAttempts";
import {
  apiRequest,
  createRouteHarness,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";
import { POST as QUOTE } from "@/app/api/pay/[publicId]/quote/route";
import { expireQuotes, type ExpireDeps } from "./expireQuotes";

let harness: RouteHarness;
let logs: string[];
let deps: ExpireDeps;

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
/** Past the 30-minute NEAR window `deadlineForOriginChain` gave the quote. */
const PAST_DEADLINE_MS = 31 * 60_000;

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

describe("expireQuotes — one tick", () => {
  it("does nothing while the quote is still inside its deadline", async () => {
    await harness.seededInvoice();

    expect(await expireQuotes(deps)).toEqual({
      checked: 0,
      expired: 0,
      lateDeposit: 0,
      deferred: 0,
      failed: 0,
    });
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/status")).toEqual([]);
  });

  it("expires an unpaid quote whose deadline has passed, and opens the invoice again", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.advance(PAST_DEADLINE_MS);
    // 1Click keeps no record of this deposit address, so no deposit can ever be reported for it.

    const tick = await expireQuotes(deps);

    expect(tick).toMatchObject({ checked: 1, expired: 1, lateDeposit: 0, failed: 0 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "expired" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "open" });
    // Terminal, so it stops blocking the one-live-attempt rule: the client can get a new address.
    expect(await findActiveAttemptForInvoice(harness.db, invoiceId)).toBeNull();
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
  });

  it("expires on 1Click's own confirmation that nothing was deposited", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.advance(PAST_DEADLINE_MS);
    harness.oneClick.statuses(statusesFixture.PENDING_DEPOSIT);

    expect(await expireQuotes(deps)).toMatchObject({ checked: 1, expired: 1 });
    expect(await storedAttempt(attempt.id)).toMatchObject({
      status: "expired",
      oneclickStatus: "PENDING_DEPOSIT",
    });
  });

  it("records a deposit that lands after the deadline instead of expiring it", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.advance(PAST_DEADLINE_MS);
    harness.oneClick.statuses(statusesFixture.KNOWN_DEPOSIT_TX);

    const tick = await expireQuotes(deps);

    // This is the whole reason for the last-minute read: `expired` is terminal, so getting it wrong
    // would leave a paid invoice unpaid with no way to correct it.
    expect(tick).toMatchObject({ checked: 1, expired: 0, lateDeposit: 1 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "payment_detected" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "payment_detected" });
  });

  it("defers while 1Click is unreachable, then expires once it answers", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.advance(PAST_DEADLINE_MS);
    harness.oneClick.failOnce("/v0/status", 500);

    const deferred = await expireQuotes(deps);

    // Nothing is lost by waiting a minute: an expired quote is refunded on its own deadline, and
    // expiring on a network failure is the unrecoverable mistake.
    expect(deferred).toMatchObject({ checked: 1, expired: 0, deferred: 1 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "awaiting_deposit" });
    expect(logs.join("\n")).toContain("deferred");

    harness.oneClick.reset();
    expect(await expireQuotes(deps)).toMatchObject({ expired: 1 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "expired" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "open" });
  });

  it("never expires an attempt that already settled", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    await recordAttemptStatus(harness.db, { attemptId: attempt.id, oneclickStatus: "SUCCESS" });
    harness.advance(PAST_DEADLINE_MS);
    harness.oneClick.statuses(statusesFixture.SUCCESS);

    expect(await expireQuotes(deps)).toMatchObject({ checked: 0, expired: 0 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "success" });
  });

  it("leaves an attempt that already has a deposit alone, even past the deadline", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    await recordAttemptStatus(harness.db, { attemptId: attempt.id, oneclickStatus: "PROCESSING" });
    harness.advance(PAST_DEADLINE_MS);

    expect(await expireQuotes(deps)).toMatchObject({ checked: 0, expired: 0 });
    expect(await storedAttempt(attempt.id)).toMatchObject({ status: "processing" });
    // Not a candidate at all, so the tick never even asked 1Click about it.
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/status")).toEqual([]);
  });

  it("expires every due quote in one tick, across invoices", async () => {
    const first = await harness.seededInvoice();
    const second = await harness.seededInvoice();
    const one = await openAttempt(first.publicId);
    const two = await openAttempt(second.publicId);
    harness.advance(PAST_DEADLINE_MS);

    expect(await expireQuotes(deps)).toMatchObject({ checked: 2, expired: 2 });
    expect(await storedAttempt(one.id)).toMatchObject({ status: "expired" });
    expect(await storedAttempt(two.id)).toMatchObject({ status: "expired" });
    expect(await storedInvoice(first.invoiceId)).toMatchObject({ status: "open" });
    expect(await storedInvoice(second.invoiceId)).toMatchObject({ status: "open" });
  });

  it("logs the attempt id, and nothing about the client", async () => {
    const { publicId } = await harness.seededInvoice();
    const attempt = await openAttempt(publicId);
    harness.advance(PAST_DEADLINE_MS);

    await expireQuotes(deps);

    const expiry = logs.filter((line) => line.includes("expireQuotes"));
    expect(expiry).toHaveLength(1);
    expect(expiry[0]).toContain(attempt.id);
    expect(expiry[0]).not.toContain(attempt.depositAddress);
    expect(expiry[0]).not.toContain("payer.testnet");
  });
});
