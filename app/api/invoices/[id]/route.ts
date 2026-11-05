/**
 * GET /api/invoices/:id — detail.
 * Roadmap: S3.3 · Spec: ARCHITECTURE.md §3.1
 *
 * The row is looked up by id and then filtered by owner: another user's invoice answers 404, not 403,
 * so this route cannot be used to confirm that an id exists.
 */

import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { detail } from "@/lib/server/invoices";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    const { id } = await params;
    return json(await detail(deps, principal, id));
  });
}
