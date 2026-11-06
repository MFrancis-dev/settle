/**
 * GET /api/invoices — list.
 * POST /api/invoices — create.
 * Roadmap: S3.3 · Spec: ARCHITECTURE.md §3.1, §5
 *
 * Creation is one step: a new invoice is `open` and its pay link is shareable immediately, so the
 * MVP has no separate "send" call (§5). Numbers come back as the base-unit strings the client sent.
 */

import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { requireSession, limitWrite } from "@/lib/server/auth";
import { createFromBody, list } from "@/lib/server/invoices";

export async function GET(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    const url = new URL(request.url);
    return json(await list(deps, principal, url.searchParams));
  });
}

export async function POST(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    // S7.7: a script cannot mint unguessable pay links in bulk from one account.
    limitWrite(deps, "invoice", request, principal.user.id);
    return json(await createFromBody(deps, principal, request), { status: 201 });
  });
}
