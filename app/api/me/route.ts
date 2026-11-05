/**
 * GET /api/me — profile + active payout destination.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1
 *
 * The dashboard's single read. It is session-only and returns no secrets: the session cookie is
 * already the credential, so this is the shape the UI would otherwise have to reconstruct.
 */

import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { meView, requireSession } from "@/lib/server/auth";

export async function GET(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    return json(await meView(deps, principal.user));
  });
}
