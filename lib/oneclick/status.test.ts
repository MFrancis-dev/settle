/**
 * S2.4 — every 1Click status, from recorded fixtures, plus the SDK drift guard.
 * Spec: ARCHITECTURE.md §3.3 (status mapping), §3.4 (deposit submit)
 *
 * The mapping table itself is tested in `lib/core/status.test.ts`; what these tests pin is the
 * boundary: the wire strings the vendor actually sends, the shape the response really has,
 * and the two failure modes that lose money if we get them wrong — a 404 read as `FAILED`,
 * and a status we have never seen read as anything other than a broken response.
 */

import { describe, expect, it } from "vitest";

import statusesFixture from "./__fixtures__/statuses.json";
import { attemptStatusFromOneClick, ONECLICK_STATUSES } from "../core/status";
import { createOneClickClient, OneClickError, type FetchLike } from "./client";
import {
  executionStatusSchema,
  getExecutionStatus,
  SDK_ONECLICK_STATUSES,
  submitDepositTx,
} from "./status";

const statusEntries = ONECLICK_STATUSES.map((status) => [status, statusesFixture[status]] as const);

interface Call {
  url: string;
  init?: RequestInit;
}

function responding(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { calls, client: createOneClickClient({ fetchImpl }) };
}

const DEPOSIT_ADDRESS = "settle-deposit-0001";
const TX_HASH = "4TgvmXtcYELrQT72yVfwCEEIJKLMNOPQR123456STUVWX";

describe("status union", () => {
  it("matches the installed SDK exactly, in case the vendor adds or renames a value", () => {
    // The SDK is generated from the live OpenAPI schema, so this is as close to a recording as we get.
    expect([...SDK_ONECLICK_STATUSES].sort()).toEqual([...ONECLICK_STATUSES].sort());
  });

  it("parses every recorded status into the union", () => {
    for (const [status, body] of statusEntries) {
      expect(executionStatusSchema.parse(structuredClone(body)).status).toBe(status);
    }
  });

  it("rejects a status the vendor has not told us about instead of guessing", async () => {
    const unknown = { ...structuredClone(statusesFixture.PENDING_DEPOSIT), status: "REVERSED" };
    const { client } = responding(unknown);
    await expect(getExecutionStatus(client, DEPOSIT_ADDRESS)).rejects.toBeInstanceOf(OneClickError);
    await expect(getExecutionStatus(client, DEPOSIT_ADDRESS)).rejects.toThrow(
      /unexpected GET \/v0\/status body/,
    );
  });
});

describe("getExecutionStatus", () => {
  it.each(statusEntries)("maps %s to its Settle attempt status", async (status, body) => {
    const { client } = responding(body);
    const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
    expect(result.status).toBe(status);
    expect(result.attemptStatus).toBe(attemptStatusFromOneClick(status));
    expect(result.updatedAt).toBe(body.updatedAt);
  });

  it("asks for the deposit address in the query string", async () => {
    const { calls, client } = responding(statusEntries[0]?.[1]);
    await getExecutionStatus(client, DEPOSIT_ADDRESS);
    expect(calls[0]?.url).toBe(
      `https://1click.chaindefuser.com/v0/status?depositAddress=${DEPOSIT_ADDRESS}`,
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("threads the deposit memo when the quote used MEMO mode", async () => {
    const { calls, client } = responding(statusEntries[0]?.[1]);
    await getExecutionStatus(client, DEPOSIT_ADDRESS, "invoice-42");
    expect(calls[0]?.url).toContain(`?depositAddress=${DEPOSIT_ADDRESS}&depositMemo=invoice-42`);
  });

  it("omits an absent memo rather than sending an empty one", async () => {
    const { calls, client } = responding(statusEntries[0]?.[1]);
    await getExecutionStatus(client, DEPOSIT_ADDRESS, null);
    expect(calls[0]?.url).not.toContain("depositMemo");
  });

  it("defaults the transaction lists when the service has not created any yet", async () => {
    const { client } = responding({
      correlationId: "st-minimal-0001",
      status: "PENDING_DEPOSIT",
      updatedAt: "2026-11-05T09:05:00Z",
      swapDetails: {},
    });
    const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
    expect(result).toMatchObject({
      depositedAmount: null,
      refundedAmount: null,
      refundReason: null,
      settledAmountIn: null,
      settledAmountOut: null,
      depositTxHashes: [],
      deliveryTxHashes: [],
      intentHashes: [],
    });
  });

  it("keeps the raw response for the receipt, including the echoed quote", async () => {
    const { client } = responding(statusesFixture.SUCCESS);
    const raw = (await getExecutionStatus(client, DEPOSIT_ADDRESS)).raw as {
      quoteResponse?: { signature?: string };
    };
    expect(raw.quoteResponse?.signature).toBe("ed25519 UNSIGNED FIXTURE");
  });

  describe("the figures that decide whether an invoice is paid", () => {
    it("sees a deposit but no swap while the intent is still open", async () => {
      const { client } = responding(statusesFixture.KNOWN_DEPOSIT_TX);
      const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
      expect(result.attemptStatus).toBe("payment_detected");
      expect(result.depositedAmount).toBe("2700000000000000000000000");
      expect(result.depositTxHashes).toEqual(["7SiwnYUbZDMsJT83zUgxFDDHABCDEF123456GHJKLMNO"]);
      expect(result.deliveryTxHashes).toEqual([]);
      expect(result.settledAmountOut).toBeNull();
    });

    it("marks a short deposit underpaid with the amount that actually landed", async () => {
      const { client } = responding(statusesFixture.INCOMPLETE_DEPOSIT);
      const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
      expect(result.attemptStatus).toBe("underpaid");
      expect(result.depositedAmount).toBe("1000000000000000000000000");
      expect(result.settledAmountOut).toBeNull();
    });

    it("reports the settled amounts and the delivery tx on success", async () => {
      const { client } = responding(statusesFixture.SUCCESS);
      const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
      expect(result.attemptStatus).toBe("success");
      // amountIn settles below the deposit: the rest was slippage, and the invoice still pays in full.
      expect(result.settledAmountIn).toBe("2610000000000000000000000");
      expect(result.settledAmountOut).toBe("10000000");
      expect(result.depositedAmount).toBe("2700000000000000000000000");
      expect(result.refundedAmount).toBeNull();
      expect(result.intentHashes).toHaveLength(1);
      expect(result.deliveryTxHashes).toHaveLength(1);
    });

    it("distinguishes a refund of a short deposit from a failed swap", async () => {
      const { client } = responding(statusesFixture.REFUNDED);
      const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
      expect(result.attemptStatus).toBe("refunded");
      expect(result.refundedAmount).toBe("1000000000000000000000000");
      expect(result.refundReason).toBe("DEPOSIT_TOO_SMALL");
      expect(result.depositTxHashes).toEqual([TX_HASH]);
    });

    it("keeps the refund reason when the relay fails mid-swap", async () => {
      const { client } = responding(statusesFixture.FAILED);
      const result = await getExecutionStatus(client, DEPOSIT_ADDRESS);
      expect(result.attemptStatus).toBe("failed");
      expect(result.refundedAmount).toBe("2700000000000000000000000");
      expect(result.refundReason).toBe("RELAY_UNAVAILABLE");
    });
  });

  it("treats an unknown deposit address as no signal, never as a failure", async () => {
    const { client } = responding({ message: "Not found" }, 404);
    const error = await getExecutionStatus(client, "settle-nosuch-01").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(OneClickError);
    expect((error as OneClickError).kind).toBe("not_found");
    expect((error as OneClickError).status).toBe(404);
  });
});

describe("submitDepositTx", () => {
  it("tells the service about a deposit it has not indexed yet", async () => {
    const { calls, client } = responding({
      correlationId: "st-submit-001",
      status: "KNOWN_DEPOSIT_TX",
      updatedAt: "2026-11-05T09:06:00Z",
    });
    const result = await submitDepositTx(client, {
      txHash: TX_HASH,
      depositAddress: DEPOSIT_ADDRESS,
      nearSenderAccount: "client.near",
    });

    expect(calls[0]?.url).toBe("https://1click.chaindefuser.com/v0/deposit/submit");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      txHash: TX_HASH,
      depositAddress: DEPOSIT_ADDRESS,
      nearSenderAccount: "client.near",
    });
    expect(result).toEqual({ status: "KNOWN_DEPOSIT_TX", updatedAt: "2026-11-05T09:06:00Z" });
  });

  it("sends the memo for a MEMO-mode deposit", async () => {
    const { calls, client } = responding({
      correlationId: "st-submit-002",
      status: "KNOWN_DEPOSIT_TX",
      updatedAt: "2026-11-05T09:06:00Z",
    });
    await submitDepositTx(client, {
      txHash: TX_HASH,
      depositAddress: DEPOSIT_ADDRESS,
      depositMemo: "invoice-42",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ memo: "invoice-42" });
  });

  it("does not turn a rejected submission into a lost deposit", async () => {
    const { client } = responding({ message: "Internal Server Error" }, 500);
    await expect(
      submitDepositTx(client, { txHash: TX_HASH, depositAddress: DEPOSIT_ADDRESS }),
    ).rejects.toThrowError(OneClickError);
  });
});
