/**
 * GET /api/health — the liveness probe a host points at.
 * Roadmap: S8.3 · Spec: ARCHITECTURE.md §3.1, §6
 *
 * Unauthenticated on purpose: a load balancer has no session cookie, and the body carries nothing
 * that is not already public — the pay page answers `demo` too (`lib/server/pay.ts`). It is 503 and
 * not 200 when the database cannot be read, because a probe that stays green while the app cannot
 * open an invoice would restart nothing and tell a deployer everything is fine.
 *
 * Not rate limited, unlike every other unauthenticated read here: it calls no upstream API and
 * writes nothing, so throttling it would only make a host mark a healthy container down.
 */

import { sql } from "drizzle-orm";

import { getServerDeps } from "@/lib/server/deps";
import { isDemoMode, parseEnv } from "@/lib/server/env-schema";
import { json } from "@/lib/server/http";

/** Which of the two run modes this process is in. Read from `process.env` and not from the deps'
 * parsed copy, because the case this probe exists for is the one where deps could not be built at
 * all. A process that cannot read its own environment is not in demo mode — it is broken, and the
 * probe below says so. */
function demoFlag(): boolean {
  try {
    return isDemoMode(parseEnv());
  } catch {
    return false;
  }
}

/** The failure that goes to the server log. The client gets the fixed body below, never this. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
  return typeof error;
}

export async function GET(): Promise<Response> {
  const demo = demoFlag();
  try {
    const deps = await getServerDeps();
    await deps.db.execute(sql`select 1`);
    return json({ status: "ok", demo, database: "ok" });
  } catch (error) {
    console.error(`health: not ok — ${describeFailure(error)}`);
    return json({ status: "degraded", demo, database: "unreachable" }, { status: 503 });
  }
}
