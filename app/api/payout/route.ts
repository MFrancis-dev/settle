/**
 * PUT /api/payout — change payout destination (fresh NEP-413 required).
 * GET /api/payout — the change log, oldest destination still visible.
 * Roadmap: S3.2 · Spec: ARCHITECTURE.md §3.1, §4
 *
 * The write is the only route in the API that needs a second signature: a session proves who you are,
 * but it does not prove that a wallet agreed to move the payout address (§6).
 */

import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { payoutHistory, requireSession } from "@/lib/server/auth";
import { setPayoutFromBody } from "@/lib/server/payout";

export async function GET(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    return json({ payouts: await payoutHistory(deps, principal.user) });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    return json(await setPayoutFromBody(deps, principal, request));
  });
}
