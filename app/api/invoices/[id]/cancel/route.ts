import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { requireSession, limitWrite } from "@/lib/server/auth";
import { cancel } from "@/lib/server/invoices";

/**
 * POST /api/invoices/:id/cancel — cancel if unpaid.
 * Roadmap: S3.3 · Spec: ARCHITECTURE.md §3.1, §4
 *
 * A status and a timestamp, never a deletion. Cancelling twice is a 200 with the same body, and a
 * settled invoice is a 409 — the money is already where it is.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    const { id } = await params;
    limitWrite(deps, "cancel", request, principal.user.id);
    return json(await cancel(deps, principal, id));
  });
}
