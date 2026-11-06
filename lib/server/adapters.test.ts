/**
 * The adapter choice: which payment implementation a process gets, and what the demo one reports.
 * Roadmap: S6.1 · Spec: ARCHITECTURE.md §3.2, §7, §8
 *
 * These are the guards that keep "demo" from ever being a property of a deployment that could take a
 * real payment, plus the mirror that lets the worker and the pay page poll a simulated deposit. Both
 * are pure functions of the environment and of an attempt row, so the tests are pure too — no
 * database, no transport, nothing of Settle's own substituted (AGENTS.md §8).
 */

import { describe, expect, it } from "vitest";

import {
  assertDemoModeAllowed,
  demoModeConflict,
  demoStageFromAttempt,
  managerKeyFor,
} from "./adapters";
import { parseEnv, type Env } from "./env-schema";
import { DEMO_MANAGER_PUBLIC_KEY } from "../oneclick/demo";
import { ATTEMPT_STATUSES, type AttemptStatus } from "../core/status";
import type { PaymentAttemptRecord } from "../db/queries/paymentAttempts";
import type { BaseUnits } from "../core/types";

const BASE = {
  SESSION_SECRET: "settle-adapters-test-secret-0123456789abcdef",
  PUBLIC_APP_URL: "http://localhost:3000",
  ONECLICK_MANAGER_PUBLIC_KEY: "ed25519:RealManagerKey1111111111111111111111111111111",
};

function env(overrides: Record<string, string> = {}): Env {
  return parseEnv({ ...BASE, ...overrides });
}

describe("demoModeConflict", () => {
  it("is silent when demo mode is off, whatever else the environment says", () => {
    expect(demoModeConflict(env())).toBeNull();
    expect(demoModeConflict(env({ DATABASE_URL: "postgres://example/db" }))).toBeNull();
  });

  it("allows a local demo on the embedded database", () => {
    expect(demoModeConflict(env({ DEMO_MODE: "1" }))).toBeNull();
    expect(() => assertDemoModeAllowed(env({ DEMO_MODE: "1" }))).not.toThrow();
  });

  it("refuses to run demo mode against a real database", () => {
    const conflict = demoModeConflict(
      env({ DEMO_MODE: "1", DATABASE_URL: "postgres://example/db" }),
    );
    expect(conflict).toContain("DATABASE_URL");
    expect(() =>
      assertDemoModeAllowed(env({ DEMO_MODE: "1", DATABASE_URL: "postgres://example/db" })),
    ).toThrow(/DATABASE_URL/);
  });

  it("refuses to run demo mode on a public https deployment", () => {
    const conflict = demoModeConflict(
      env({ DEMO_MODE: "1", PUBLIC_APP_URL: "https://settle.example" }),
    );
    expect(conflict).toContain("settle.example");
    expect(conflict).toContain("must never simulate one");
  });
});

describe("managerKeyFor", () => {
  it("pins the published demo key in demo mode, so a re-signed dry quote verifies", () => {
    expect(managerKeyFor(env({ DEMO_MODE: "1" }))).toBe(DEMO_MANAGER_PUBLIC_KEY);
    // Not the configured one: in demo mode there is exactly one key that can sign a quote.
    expect(managerKeyFor(env({ DEMO_MODE: "1" }))).not.toBe(BASE.ONECLICK_MANAGER_PUBLIC_KEY);
  });

  it("uses the configured partner key otherwise, and null when there is none", () => {
    expect(managerKeyFor(env())).toBe(BASE.ONECLICK_MANAGER_PUBLIC_KEY);
    const { ONECLICK_MANAGER_PUBLIC_KEY: _unused, ...rest } = BASE;
    expect(managerKeyFor(parseEnv(rest))).toBeNull();
  });
});

function attempt(overrides: Partial<PaymentAttemptRecord> = {}): PaymentAttemptRecord {
  const at = new Date("2026-11-05T09:00:00Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    invoiceId: "22222222-2222-4222-8222-222222222222",
    payoutDestinationId: "33333333-3333-4333-8333-333333333333",
    originAsset: "nep141:wrap.near",
    refundTo: "client.near",
    depositAddress: "settle-demo-0001",
    depositMemo: "memo-1",
    // `amountIn` is what the client sends and `amountOut` what the freelancer receives; the mirror
    // reports the deposit side, so the two are kept distinct here to prove which one it reads.
    amountIn: "1010000" as BaseUnits,
    amountOut: "1000000" as BaseUnits,
    feeUsd: null,
    quoteDeadline: new Date(at.getTime() + 600_000),
    quoteSignature: "ed25519:demo",
    quoteRaw: { correlationId: "st-demo", quote: { amountOut: "1000000" } },
    oneclickStatus: "PENDING_DEPOSIT",
    status: "awaiting_deposit",
    depositTxHash: null,
    deliveryTxHash: null,
    statusRaw: null,
    receiptToken: "receipt-token",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  } as PaymentAttemptRecord;
}

describe("demoStageFromAttempt", () => {
  it("reports nothing to deposit as a pending deposit, with no amount invented", () => {
    const stage = demoStageFromAttempt(attempt());
    expect(stage).toMatchObject({ status: "PENDING_DEPOSIT", depositedAmount: null });
  });

  it("reports a short deposit as half of what was asked for", () => {
    const stage = demoStageFromAttempt(
      attempt({ status: "underpaid", oneclickStatus: "INCOMPLETE_DEPOSIT" }),
    );
    expect(stage).toMatchObject({ status: "INCOMPLETE_DEPOSIT", depositedAmount: "505000" });
  });

  it("reports a refund with the amount and a reason a judge can read", () => {
    const stage = demoStageFromAttempt(
      attempt({ status: "refunded", oneclickStatus: "REFUNDED", depositTxHash: "deposit-hash" }),
    );
    expect(stage).toMatchObject({ status: "REFUNDED", refundedAmount: "1010000" });
    expect(stage?.refundReason).toContain("deadline");
  });

  it("carries this payment's own hashes and quote through to the mirror", () => {
    const stage = demoStageFromAttempt(
      attempt({
        status: "success",
        oneclickStatus: "SUCCESS",
        depositTxHash: "deposit-hash",
        deliveryTxHash: "delivery-hash",
      }),
    );
    expect(stage).toMatchObject({
      status: "SUCCESS",
      depositedAmount: "1010000",
      depositTxHash: "deposit-hash",
      deliveryTxHash: "delivery-hash",
    });
    expect(stage?.quoteResponse).toEqual({
      correlationId: "st-demo",
      quote: { amountOut: "1000000" },
    });
  });

  it("reports nothing at all for an expired quote, which is why the service answers 404", () => {
    expect(demoStageFromAttempt(attempt({ status: "expired" }))).toBeNull();
  });

  it("has an answer for every attempt status, so a new one cannot be silently dropped", () => {
    const mapped = ATTEMPT_STATUSES.map((status: AttemptStatus) =>
      demoStageFromAttempt(attempt({ status })),
    );
    // `expired` is the only status with no 1Click equivalent; everything else must map.
    expect(mapped.filter((stage) => stage === null)).toHaveLength(1);
    expect(mapped.filter((stage) => stage !== null)).toHaveLength(ATTEMPT_STATUSES.length - 1);
  });
});
