/**
 * Chooses the payment implementation: the real 1Click transport, or the demo one.
 * Roadmap: S6.1 · Spec: ARCHITECTURE.md §3.2, §7, §8
 *
 * No `server-only` marker, for the reason recorded in `lib/server/db.ts`: `deps.ts` imports this and
 * the worker plus the tsx scripts import `deps.ts`, and that package throws under plain Node. Client
 * components must never import it — the partner JWT reaches the transport from here.
 *
 * ARCHITECTURE.md §7 asks for the choice to be made "by session type". It is made by a process-wide
 * flag instead, and the reason is the pay path: a client has no session at all (§6), so a per-session
 * choice could not cover the one screen the demo exists to show. `DEMO_MODE` is set only by
 * `pnpm demo`, and `assertDemoModeAllowed` refuses to honour it on a deployment that could take a real
 * payment, so "demo" can never be a property of one visitor to a live app.
 */

import type { Database } from "../db/client";
import { findAttemptByDepositAddress, type PaymentAttemptRecord } from "../db/queries/paymentAttempts";
import { DEMO_USDC_ON_NEAR, type SeedDemoOptions } from "../db/seed-demo";
import {
  DEMO_MANAGER_PUBLIC_KEY,
  buildDemoQuote,
  createDemoOneClickFetch,
  demoTxHash,
  type DemoStage,
} from "../oneclick/demo";
import { createOneClickClient, type FetchLike, type OneClickClient } from "../oneclick/client";
import { createTokenRegistry, type TokenRegistry } from "../oneclick/tokens";
import type { AttemptStatus, OneClickStatus } from "../core/status";
import { isDemoMode, type Env } from "./env-schema";

export interface PaymentAdapters {
  readonly oneClick: OneClickClient;
  readonly tokens: TokenRegistry;
}

export interface PaymentAdaptersConfig {
  db: Database;
  env: Env;
  now: () => number;
  /** A transport handed in by a test; it wins over both the real and the demo one. */
  oneClickFetch?: FetchLike;
}

/**
 * The key expected to sign a quote. Demo mode always pins the demo key — a forwarded dry quote is
 * re-signed with it, so one key verifies every quote in a demo process.
 */
export function managerKeyFor(env: Env): string | null {
  if (isDemoMode(env)) return DEMO_MANAGER_PUBLIC_KEY;
  return env.ONECLICK_MANAGER_PUBLIC_KEY ?? null;
}

/** Why `DEMO_MODE` must not be honoured, or `null` when it may be. */
export function demoModeConflict(env: Env): string | null {
  if (!isDemoMode(env)) return null;
  if (env.DATABASE_URL !== undefined) {
    return "DEMO_MODE is set together with DATABASE_URL: demo mode writes fictional rows and must run on the embedded database.";
  }
  if (env.PUBLIC_APP_URL.startsWith("https://")) {
    return `DEMO_MODE is set together with a public PUBLIC_APP_URL (${new URL(env.PUBLIC_APP_URL).host}): a deployment that can take a real payment must never simulate one.`;
  }
  return null;
}

/** Refuse to start a demo that could touch a real database or a real deployment. */
export function assertDemoModeAllowed(env: Env): void {
  const conflict = demoModeConflict(env);
  if (conflict) throw new Error(conflict);
}

/**
 * What the demo service reports for a deposit address: exactly what the attempt row already says.
 *
 * The demo transport is a mirror of the database rather than a second state machine, so the worker's
 * poll and the pay page's poll read back the state `simulate-payment` wrote and change nothing.
 * `expired` answers 404 — the service keeps no record of a quote that lapsed with no deposit — which
 * also keeps a terminal row out of the forward-only write.
 */
const ONECLICK_STATUS_BY_ATTEMPT: Readonly<Record<AttemptStatus, OneClickStatus | null>> = {
  awaiting_deposit: "PENDING_DEPOSIT",
  payment_detected: "KNOWN_DEPOSIT_TX",
  processing: "PROCESSING",
  success: "SUCCESS",
  underpaid: "INCOMPLETE_DEPOSIT",
  refunded: "REFUNDED",
  failed: "FAILED",
  expired: null,
};

export function demoStageFromAttempt(row: PaymentAttemptRecord): DemoStage | null {
  const status = ONECLICK_STATUS_BY_ATTEMPT[row.status];
  if (status === null) return null;

  // A short deposit is the one figure the row does not carry, so the demo halves what was asked for.
  const deposited = status === "PENDING_DEPOSIT" ? null : row.amountIn;
  const short = (BigInt(row.amountIn) / 2n).toString();

  return {
    status,
    depositedAmount: status === "INCOMPLETE_DEPOSIT" ? short : deposited,
    refundedAmount: status === "REFUNDED" ? row.amountIn : null,
    refundReason: status === "REFUNDED" ? "The deadline passed before the full deposit arrived." : null,
    depositTxHash: row.depositTxHash,
    deliveryTxHash: row.deliveryTxHash,
    quoteResponse: row.quoteRaw,
  };
}

/**
 * What the demo seed writes with: `buildDemoQuote` for its quotes and `demoTxHash` for its hashes.
 *
 * It lives here rather than in `lib/db/seed-demo.ts` because that module may not import `lib/oneclick`
 * (project_structure.md §1 makes them siblings), and here rather than in `lib/server/demo.ts` because
 * `scripts/seed-demo.ts` needs it too and must not pull `next/server` into a plain Node process.
 */
export function demoSeedOptions(now: () => number): SeedDemoOptions {
  return {
    quoteFor: (input) =>
      buildDemoQuote(
        {
          originAsset: input.originAsset,
          // The demo freelancer cashes out in USDC on NEAR, so every seeded quote delivers there.
          destinationAsset: DEMO_USDC_ON_NEAR,
          amount: String(input.amountOut),
          recipient: input.recipient,
          refundTo: input.refundTo,
          deadline: input.deadline,
        },
        { now },
      ),
    hashFor: demoTxHash,
    now,
  };
}

/** Build the transport and the token registry that reads through it. */
export function createPaymentAdapters(config: PaymentAdaptersConfig): PaymentAdapters {
  const { env, now } = config;
  const baseUrl = env.ONECLICK_BASE_URL;

  let fetchImpl = config.oneClickFetch;
  if (!fetchImpl && isDemoMode(env)) {
    assertDemoModeAllowed(env);
    fetchImpl = createDemoOneClickFetch({
      now,
      stage: async (depositAddress) => {
        const row = await findAttemptByDepositAddress(config.db, depositAddress);
        return row ? demoStageFromAttempt(row) : null;
      },
      // §7: real dry quotes when the network is reachable, the recording when it is not. `fetch` is
      // resolved per call rather than captured here, so a test can stand in for the network without
      // rebuilding the deps that already hold this transport.
      upstream: {
        fetch: (input, init) => globalThis.fetch(input, init),
        baseUrl,
        ...(env.ONECLICK_JWT ? { jwt: env.ONECLICK_JWT } : {}),
      },
    });
  }

  const oneClick = createOneClickClient({
    baseUrl,
    jwt: env.ONECLICK_JWT,
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  return { oneClick, tokens: createTokenRegistry({ client: oneClick, now }) };
}
