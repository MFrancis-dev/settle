/**
 * Starts the worker loops and shuts them down cleanly.
 * Roadmap: S5.1 · Spec: ARCHITECTURE.md §3.4
 *
 * `pnpm worker` = `tsx worker/index.ts`. Nothing runs at import time, so a test can start a loop with
 * an injected `sleep` and a fake tick, and the Next.js app can import this module without spawning a
 * background process.
 *
 * Graceful shutdown matters here specifically: a tick that is killed mid-write can leave an attempt
 * polled upstream but not recorded, and the loops are the only thing that moves money-bearing rows
 * forward when nobody is watching the pay page. So a signal stops *scheduling*, waits for the tick in
 * flight, then closes the database. A second signal means "stop waiting" and exits at once.
 */

import { pathToFileURL } from "node:url";

import { isOneClickJwtConfigured, missingRealModeKeys } from "../lib/server/env-schema";
import { closeDatabase } from "../lib/server/db";
import { getServerDeps, type ServerDeps } from "../lib/server/deps";
import { expireQuotes, type ExpireTick } from "./expireQuotes";
import { pollPayments, POLL_BATCH, type PollTick, type WorkerDeps } from "./pollPayments";

export const POLL_INTERVAL_MS = 5_000;
export const EXPIRE_INTERVAL_MS = 60_000;

export interface LoopSpec {
  readonly name: string;
  readonly everyMs: number;
  /** One tick. A throw is logged and the loop continues — a bad tick must not kill the worker. */
  readonly tick: () => Promise<unknown>;
}

export interface LoopControls {
  /** Injected in tests so a loop can be driven without waiting for real time. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
}

export interface RunningLoop {
  readonly name: string;
  /** Stops scheduling, waits for the tick in flight, and resolves. Idempotent. */
  stop(): Promise<void>;
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
  return typeof error;
}

const consoleLog = (message: string): void => {
  console.log(message);
};

/** Start one loop. The returned `stop()` resolves once the in-flight tick has finished. */
export function startLoop(spec: LoopSpec, controls: LoopControls = {}): RunningLoop {
  const sleep =
    controls.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = controls.log ?? consoleLog;

  let stopping = false;
  let wake: (() => void) | undefined;
  // Resolved by `stop()` so the interval wait ends immediately instead of running out its 5 s or 60 s.
  const woken = new Promise<void>((resolve) => {
    wake = resolve;
  });

  const body = (async () => {
    while (!stopping) {
      try {
        await spec.tick();
      } catch (error) {
        log(`${spec.name}: tick failed — ${describeFailure(error)}`);
      }
      if (stopping) break;
      await Promise.race([sleep(spec.everyMs), woken]);
    }
  })();

  return {
    name: spec.name,
    async stop() {
      stopping = true;
      wake?.();
      await body;
    },
  };
}

export interface WorkerConfig {
  readonly deps: ServerDeps;
  readonly log?: (message: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number;
  readonly expireMs?: number;
}

export interface RunningWorker {
  readonly loops: readonly RunningLoop[];
  stop(): Promise<void>;
}

function summarisePoll(tick: PollTick): string | null {
  if (tick.failed > 0)
    return `${tick.checked} checked, ${tick.advanced} advanced, ${tick.failed} failed`;
  if (tick.advanced > 0) return `${tick.checked} checked, ${tick.advanced} advanced`;
  return null;
}

function summariseExpire(tick: ExpireTick): string | null {
  if (tick.failed > 0)
    return `${tick.checked} candidates, ${tick.expired} expired, ${tick.failed} failed`;
  if (tick.expired > 0 || tick.lateDeposit > 0) {
    return `${tick.checked} candidates, ${tick.expired} expired, ${tick.lateDeposit} moved on`;
  }
  if (tick.deferred > 0) return `${tick.deferred} deferred, 1Click unreachable`;
  return null;
}

/**
 * Start both loops against a set of deps.
 *
 * The deps are the app's own composition root: the worker polls through the same 1Click client, the
 * same database handle and the same clock as the routes, so there is no second implementation of any
 * rule to drift.
 */
export function startWorker(config: WorkerConfig): RunningWorker {
  const log = config.log ?? consoleLog;
  const { db, oneClick, now } = config.deps;
  const workerDeps: WorkerDeps = { db, oneClick, now, log };

  const loops = [
    startLoop(
      {
        name: "pollPayments",
        everyMs: config.pollMs ?? POLL_INTERVAL_MS,
        tick: async () => {
          const tick = await pollPayments(workerDeps, { limit: POLL_BATCH });
          const summary = summarisePoll(tick);
          if (summary) log(`pollPayments: ${summary}`);
        },
      },
      { ...(config.sleep ? { sleep: config.sleep } : {}), log },
    ),
    startLoop(
      {
        name: "expireQuotes",
        everyMs: config.expireMs ?? EXPIRE_INTERVAL_MS,
        tick: async () => {
          const tick = await expireQuotes(workerDeps);
          const summary = summariseExpire(tick);
          if (summary) log(`expireQuotes: ${summary}`);
        },
      },
      { ...(config.sleep ? { sleep: config.sleep } : {}), log },
    ),
  ];

  return {
    loops,
    async stop() {
      // Both at once: neither tick writes to the other's rows, and waiting in series would double the
      // shutdown time for no benefit.
      await Promise.all(loops.map((loop) => loop.stop()));
    },
  };
}

/** What the process entrypoint does: build deps, start the loops, then wait for a signal. */
export async function main(log: (message: string) => void = consoleLog): Promise<RunningWorker> {
  const deps = await getServerDeps();

  const missing = missingRealModeKeys(deps.env);
  if (missing.length > 0) {
    // Names only, never values (S0.6). Not fatal: demo mode installs its own deps and needs no JWT.
    log(`worker: env is missing ${missing.join(", ")} — upstream reads will fail until it is set`);
  }
  if (!isOneClickJwtConfigured(deps.env)) {
    log("worker: no ONECLICK_JWT, so /v0/status answers 401; the loops keep retrying");
  }

  const worker = startWorker({ deps, log });
  log(
    `worker: pollPayments every ${POLL_INTERVAL_MS / 1000}s, expireQuotes every ${EXPIRE_INTERVAL_MS / 1000}s`,
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) {
      log(`worker: second ${signal}, exiting now`);
      process.exit(1);
    }
    stopping = true;
    log(`worker: ${signal} — finishing the tick in flight`);
    void worker
      .stop()
      .then(() => closeDatabase())
      .then(() => {
        log("worker: stopped");
        process.exit(0);
      })
      .catch((error: unknown) => {
        log(`worker: shutdown failed — ${describeFailure(error)}`);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return worker;
}

// Run only as `tsx worker/index.ts`, never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`worker: could not start — ${describeFailure(error)}`);
    process.exit(1);
  });
}
