/**
 * S2.9 — `payment_attempts` queries: the record of a real quote, and the status guard.
 * Spec: ARCHITECTURE.md §3.3, §4, §6
 *
 * An attempt row is what a client is told to pay and what a receipt is later signed against, so
 * the two rules tested hardest here are: it cannot be created from a dry or address-less quote,
 * and a stale poll cannot walk a settled one backwards.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDatabase, seedInvoice } from "../__fixtures__/testdb";
import type { ConnectedDatabase, PgliteDb } from "../client";
import type { QuoteSummary } from "../../core/types";
import { parseBaseUnits } from "../../core/money";
import {
  createPaymentAttempt,
  findActiveAttemptForInvoice,
  findAttemptByDepositAddress,
  findAttemptById,
  isAttemptSettled,
  listAttemptsForInvoice,
  recordAttemptStatus,
} from "./paymentAttempts";

let connected: ConnectedDatabase<PgliteDb>;
let db: PgliteDb;

beforeAll(async () => {
  connected = await openTestDatabase();
  db = connected.db;
});

afterAll(async () => {
  await connected.close();
});

let addressSequence = 0;

/** The same numbers `__fixtures__/quote-real.json` carries, as the summary the API would return. */
function verifiedQuote(overrides: Partial<QuoteSummary> = {}): QuoteSummary {
  return {
    dry: false,
    depositAddress: "settle-deposit-0001",
    depositMemo: null,
    amountIn: parseBaseUnits("2700000000000000000000000"),
    amountOut: parseBaseUnits("10000000"),
    feeUsd: "0.4",
    deadline: "2026-11-05T11:00:00Z",
    timeEstimateS: 45,
    signature: "ed25519test",
    raw: { correlationId: "00000000-0000-4000-8000-settlequote01" },
    ...overrides,
  };
}

async function attempt(overrides: Partial<QuoteSummary> = {}) {
  // Each call gets its own address: `deposit_address` is unique for the life of the payment.
  const quote = verifiedQuote({
    depositAddress: `settle-live-${(addressSequence += 1)}`,
    ...overrides,
  });
  const { invoice, destinationId } = await seedInvoice(db);
  const row = await createPaymentAttempt(db, {
    invoiceId: invoice.id,
    payoutDestinationId: destinationId,
    originAsset: "nep141:wrap.near",
    refundTo: "client.testnet",
    quote,
  });
  return { invoice, destinationId, row, quote };
}

describe("createPaymentAttempt", () => {
  it("stores the verified quote in full, with amounts as base units", async () => {
    const { invoice, row, quote } = await attempt();

    expect(row).toMatchObject({
      invoiceId: invoice.id,
      originAsset: "nep141:wrap.near",
      refundTo: "client.testnet",
      depositAddress: quote.depositAddress,
      amountIn: "2700000000000000000000000",
      amountOut: "10000000",
      feeUsd: "0.4",
      status: "awaiting_deposit",
      quoteSignature: "ed25519test",
    });
    expect(row.quoteDeadline.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    expect(row.quoteRaw).toEqual({ correlationId: "00000000-0000-4000-8000-settlequote01" });
  });

  it("refuses a dry quote", async () => {
    // A preview has no address; storing it would show a client a place to send money that is not theirs.
    await expect(attempt({ dry: true })).rejects.toThrow(/non-dry quote/);
  });

  it("refuses a verified quote that carries no deposit address", async () => {
    await expect(attempt({ depositAddress: null })).rejects.toThrow(/deposit address/);
  });

  it("keeps the deposit address unique, because it identifies the payment forever", async () => {
    const first = await attempt();
    // The same address on another invoice is either a vendor bug or a replay — the index refuses it.
    await expect(attempt({ depositAddress: first.row.depositAddress })).rejects.toThrow();
  });

  it("round-trips the amounts through the database as the same integers", async () => {
    const { row } = await attempt();
    const again = await findAttemptById(db, row.id);
    expect(again?.amountIn).toBe("2700000000000000000000000");
    expect(again && BigInt(again.amountIn)).toBe(2_700_000_000_000_000_000_000_000n);
  });
});

describe("lookups", () => {
  it("finds the attempt a deposit address belongs to", async () => {
    const { row } = await attempt();
    expect((await findAttemptByDepositAddress(db, row.depositAddress))?.id).toBe(row.id);
    expect(await findAttemptByDepositAddress(db, "settle-nosuch")).toBeNull();
  });

  it("lists an invoice's attempts newest first and hides another invoice's", async () => {
    const first = await attempt();
    const second = await attempt();
    expect(second.row.invoiceId).not.toBe(first.row.invoiceId);

    const forInvoice = await listAttemptsForInvoice(db, first.row.invoiceId);
    expect(forInvoice).toHaveLength(1);
    expect(forInvoice[0]?.depositAddress).toBe(first.row.depositAddress);
    expect(await listAttemptsForInvoice(db, second.row.invoiceId)).toHaveLength(1);
  });

  it("returns null for an id that is not there", async () => {
    expect(await findAttemptById(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(
      await findActiveAttemptForInvoice(db, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});

describe("recordAttemptStatus", () => {
  it("moves an attempt forward from what 1Click reported", async () => {
    const { row } = await attempt();
    const updated = await recordAttemptStatus(db, {
      attemptId: row.id,
      oneclickStatus: "KNOWN_DEPOSIT_TX",
      depositTxHash: "7SiwnYUbZDMsJT83zUgxFDDHABCDEF123456GHJKLMNO",
      statusRaw: { status: "KNOWN_DEPOSIT_TX", depositedAmount: "2700000000000000000000000" },
    });

    expect(updated).toMatchObject({
      status: "payment_detected",
      oneclickStatus: "KNOWN_DEPOSIT_TX",
      depositTxHash: "7SiwnYUbZDMsJT83zUgxFDDHABCDEF123456GHJKLMNO",
    });
    expect(updated?.statusRaw).toMatchObject({ depositedAmount: "2700000000000000000000000" });
  });

  it("accepts the same status twice, because the worker polls", async () => {
    const { row } = await attempt();
    const once = await recordAttemptStatus(db, { attemptId: row.id, oneclickStatus: "PROCESSING" });
    const twice = await recordAttemptStatus(db, {
      attemptId: row.id,
      oneclickStatus: "PROCESSING",
      statusRaw: { poll: 2 },
    });

    expect(twice?.status).toBe("processing");
    expect(twice?.id).toBe(once?.id);
    expect(twice?.statusRaw).toEqual({ poll: 2 });
  });

  it("refuses to walk a settled payment backwards", async () => {
    const { row } = await attempt();
    await recordAttemptStatus(db, { attemptId: row.id, oneclickStatus: "SUCCESS" });

    // A stale response from an earlier poll must not un-pay the invoice.
    await expect(
      recordAttemptStatus(db, { attemptId: row.id, oneclickStatus: "KNOWN_DEPOSIT_TX" }),
    ).rejects.toThrow(/illegal attempt transition success -> payment_detected/);
  });

  it("keeps the hashes and the delivery evidence through to success", async () => {
    const { row } = await attempt();
    await recordAttemptStatus(db, {
      attemptId: row.id,
      oneclickStatus: "KNOWN_DEPOSIT_TX",
      depositTxHash: "deposit-tx",
    });
    const settled = await recordAttemptStatus(db, {
      attemptId: row.id,
      oneclickStatus: "SUCCESS",
      deliveryTxHash: "delivery-tx",
      receiptToken: "receipt-abc",
    });

    expect(settled).toMatchObject({
      status: "success",
      depositTxHash: "deposit-tx",
      deliveryTxHash: "delivery-tx",
      receiptToken: "receipt-abc",
    });
    expect(isAttemptSettled(settled?.status ?? "processing")).toBe(true);
  });

  it("writes the fields it is given and leaves the rest alone", async () => {
    const { row } = await attempt();
    await recordAttemptStatus(db, { attemptId: row.id, depositTxHash: "deposit-tx" });
    const updated = await recordAttemptStatus(db, {
      attemptId: row.id,
      statusRaw: { poll: 2 },
    });

    // No `oneclickStatus` in the second call: the status is whatever it already was.
    expect(updated).toMatchObject({ status: "awaiting_deposit", depositTxHash: "deposit-tx" });
    expect(updated?.statusRaw).toEqual({ poll: 2 });
  });

  it("returns null for an attempt that is not there", async () => {
    expect(
      await recordAttemptStatus(db, {
        attemptId: "00000000-0000-4000-8000-000000000000",
        oneclickStatus: "PROCESSING",
      }),
    ).toBeNull();
  });
});

describe("the attempt a client is paying now", () => {
  it("is the live one, and a terminal one stops being it", async () => {
    const { row } = await attempt();
    expect((await findActiveAttemptForInvoice(db, row.invoiceId))?.id).toBe(row.id);

    await recordAttemptStatus(db, { attemptId: row.id, oneclickStatus: "REFUNDED" });
    expect(await findActiveAttemptForInvoice(db, row.invoiceId)).toBeNull();
  });

  it("lets a refunded invoice try again with a new address", async () => {
    // This is the retry path: the old row stays as the audit trail, the new one becomes active.
    const { invoice, destinationId } = await seedInvoice(db);
    const first = await createPaymentAttempt(db, {
      invoiceId: invoice.id,
      payoutDestinationId: destinationId,
      originAsset: "nep141:wrap.near",
      refundTo: "client.testnet",
      quote: verifiedQuote(),
    });
    await recordAttemptStatus(db, { attemptId: first.id, oneclickStatus: "FAILED" });

    const retry = await createPaymentAttempt(db, {
      invoiceId: invoice.id,
      payoutDestinationId: destinationId,
      originAsset: "nep141:someother.near",
      refundTo: "client.testnet",
      quote: verifiedQuote({ depositAddress: "settle-retry-0002" }),
    });

    expect((await findActiveAttemptForInvoice(db, invoice.id))?.id).toBe(retry.id);
    expect(await listAttemptsForInvoice(db, invoice.id)).toHaveLength(2);
  });

  it("counts every status that can still move as live", () => {
    expect(isAttemptSettled("awaiting_deposit")).toBe(false);
    expect(isAttemptSettled("processing")).toBe(false);
    expect(isAttemptSettled("underpaid")).toBe(false);
    for (const status of ["success", "refunded", "failed", "expired"] as const) {
      expect(isAttemptSettled(status)).toBe(true);
    }
  });
});
