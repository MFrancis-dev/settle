/**
 * S5.1 — the loop runner and graceful shutdown.
 * Spec: ARCHITECTURE.md §3.4
 *
 * `sleep` is injected, so these tests drive the scheduling without waiting for real time and without
 * fake timers: a tick either ran or it did not, and `stop()` either waited for it or it did not.
 *
 * The shutdown tests use the real database and the scripted 1Click, because the reason shutdown has
 * to be graceful is a tick caught mid-write — a payment polled upstream but never recorded.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import statusesFixture from "@/lib/oneclick/__fixtures__/statuses.json";
import { invoices } from "@/lib/db/schema";
import { findAttemptById } from "@/lib/db/queries/paymentAttempts";
import {
  apiRequest,
  createRouteHarness,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";
import { POST as QUOTE } from "@/app/api/pay/[publicId]/quote/route";
import {
  EXPIRE_INTERVAL_MS,
  POLL_INTERVAL_MS,
  startLoop,
  startWorker,
  type RunningWorker,
} from "./index";

interface FakeSleep {
  sleep: (ms: number) => Promise<void>;
  /** Every interval the loops parked on, in order. */
  waits: number[];
  /** Let the parked loops continue, as the timer would. */
  release: () => void;
}

function fakeSleep(): FakeSleep {
  const parked: (() => void)[] = [];
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        waits.push(ms);
        parked.push(resolve);
      }),
    release: () => {
      parked.splice(0).forEach((resolve) => resolve());
    },
  };
}

const WNEAR = "nep141:wrap.near";

/** Wait for `count` loops to have finished their tick and parked on the interval. */
async function untilParked(clock: FakeSleep, count: number): Promise<void> {
  for (let attempt = 0; attempt < 400 && clock.waits.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(clock.waits).toHaveLength(count);
}

describe("startLoop", () => {
  it("runs a tick at once, then waits the interval before the next one", async () => {
    const clock = fakeSleep();
    let ticks = 0;

    const loop = startLoop(
      {
        name: "test",
        everyMs: 5_000,
        tick: async () => {
          ticks += 1;
        },
      },
      { sleep: clock.sleep, log: () => {} },
    );

    // The first tick is not deferred: a worker that waited 5 s before its first poll would leave a
    // payment sitting for 5 s after every restart.
    expect(ticks).toBe(1);
    await untilParked(clock, 1);
    expect(clock.waits).toEqual([5_000]);

    clock.release();
    await untilParked(clock, 2);
    await loop.stop();
    expect(ticks).toBe(2);
    expect(clock.waits).toEqual([5_000, 5_000]);
  });

  it("stops scheduling and does not wait out the interval", async () => {
    const clock = fakeSleep();
    let ticks = 0;

    const loop = startLoop(
      { name: "test", everyMs: 60_000, tick: async () => void (ticks += 1) },
      { sleep: clock.sleep, log: () => {} },
    );

    // The loop is parked on a sleep that nothing will ever resolve: `stop()` has to wake it itself,
    // or shutting the worker down would take a whole minute.
    await untilParked(clock, 1);
    await loop.stop();

    expect(ticks).toBe(1);
    expect(clock.waits).toEqual([60_000]);
  });

  it("waits for the tick in flight before resolving", async () => {
    const clock = fakeSleep();
    let finished = false;
    let releaseTick: (() => void) | undefined;

    const loop = startLoop(
      {
        name: "slow",
        everyMs: 1_000,
        tick: () =>
          new Promise<void>((resolve) => {
            releaseTick = () => {
              finished = true;
              resolve();
            };
          }),
      },
      { sleep: clock.sleep, log: () => {} },
    );

    const stopping = loop.stop();
    let settled = false;
    void stopping.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(finished).toBe(false);

    releaseTick?.();
    await stopping;
    expect(finished).toBe(true);
    expect(settled).toBe(true);
  });

  it("logs a tick that throws and keeps the loop alive", async () => {
    const clock = fakeSleep();
    const logs: string[] = [];
    let ticks = 0;

    const loop = startLoop(
      {
        name: "flaky",
        everyMs: 1_000,
        tick: async () => {
          ticks += 1;
          if (ticks === 1) throw new Error("database went away");
        },
      },
      { sleep: clock.sleep, log: (message) => logs.push(message) },
    );

    // The throw lands in a microtask, so the loop has to be parked before there is anything to wake.
    await untilParked(clock, 1);
    clock.release();
    await untilParked(clock, 2);
    await loop.stop();

    expect(ticks).toBe(2);
    expect(logs.join("\n")).toContain("flaky: tick failed — Error: database went away");
  });

  it("is idempotent, because two signals arrive close together", async () => {
    const clock = fakeSleep();
    let ticks = 0;
    const loop = startLoop(
      { name: "test", everyMs: 1_000, tick: async () => void (ticks += 1) },
      { sleep: clock.sleep, log: () => {} },
    );

    await loop.stop();
    await loop.stop();
    expect(ticks).toBe(1);
  });
});

describe("startWorker", () => {
  let harness: RouteHarness;
  let logs: string[];
  let worker: RunningWorker | undefined;

  beforeEach(async () => {
    harness = await createRouteHarness();
    logs = [];
    worker = undefined;
  });

  afterEach(async () => {
    await worker?.stop();
    await harness.close();
  });

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
    return String(attempt.id);
  }

  async function storedInvoice(invoiceId: string) {
    const [row] = await harness.db.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!row) throw new Error("invoice vanished");
    return row;
  }

  it("schedules both loops at the intervals ARCHITECTURE §3.4 specifies", async () => {
    const clock = fakeSleep();
    worker = startWorker({ deps: harness.deps, log: (m) => logs.push(m), sleep: clock.sleep });

    // Both first ticks have to finish before their loops park on the interval.
    await untilParked(clock, 2);
    expect(clock.waits.sort((a, b) => a - b)).toEqual([POLL_INTERVAL_MS, EXPIRE_INTERVAL_MS]);
    expect(POLL_INTERVAL_MS).toBe(5_000);
    expect(EXPIRE_INTERVAL_MS).toBe(60_000);
    expect(worker.loops.map((loop) => loop.name)).toEqual(["pollPayments", "expireQuotes"]);
  });

  it("completes a payment nobody is watching, and finishes that write before stopping", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attemptId = await openAttempt(publicId);
    harness.oneClick.statuses(statusesFixture.SUCCESS);
    const clock = fakeSleep();

    worker = startWorker({ deps: harness.deps, log: (m) => logs.push(m), sleep: clock.sleep });
    // The first tick is in flight; `stop()` resolving is the promise that it finished.
    await worker.stop();

    expect(await findAttemptById(harness.db, attemptId)).toMatchObject({ status: "success" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "paid" });
    expect(logs.join("\n")).toContain("pollPayments: 1 checked, 1 advanced");
  });

  it("expires an unpaid quote past its deadline on the same deps", async () => {
    const { publicId, invoiceId } = await harness.seededInvoice();
    const attemptId = await openAttempt(publicId);
    harness.advance(31 * 60_000);
    const clock = fakeSleep();

    worker = startWorker({ deps: harness.deps, log: (m) => logs.push(m), sleep: clock.sleep });
    await worker.stop();

    expect(await findAttemptById(harness.db, attemptId)).toMatchObject({ status: "expired" });
    expect(await storedInvoice(invoiceId)).toMatchObject({ status: "open" });
  });

  it("says nothing on a tick that changed nothing, so the log stays readable", async () => {
    await harness.seededInvoice();
    const clock = fakeSleep();

    worker = startWorker({ deps: harness.deps, log: (m) => logs.push(m), sleep: clock.sleep });
    await worker.stop();

    expect(logs.filter((line) => line.startsWith("pollPayments: "))).toEqual([]);
    expect(logs.filter((line) => line.startsWith("expireQuotes: "))).toEqual([]);
  });
});
