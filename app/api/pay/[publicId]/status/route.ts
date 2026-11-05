import { getServerDeps } from "@/lib/server/deps";
import { clientIp, json, route } from "@/lib/server/http";
import { pollStatus } from "@/lib/server/pay";

/**
 * GET /api/pay/:publicId/status — current attempt status.
 * Roadmap: S3.6 · Spec: ARCHITECTURE.md §3.1, §3.4
 *
 * This read polls 1Click and applies the same forward-only, idempotent update the worker does, so a
 * payment looks paid the moment the pay page asks. The response carries `polled` for exactly that
 * reason: "no update" must never be read as "not paid".
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { publicId } = await params;
    return json(await pollStatus(deps, { publicId, ip: clientIp(request) }));
  });
}
