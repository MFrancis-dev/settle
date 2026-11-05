import { receiptQueryInput } from "@/lib/core/schemas";
import { getServerDeps } from "@/lib/server/deps";
import { json, parseQuery, route } from "@/lib/server/http";
import { receipt } from "@/lib/server/receipts";

/**
 * GET /api/receipts/:attemptId — receipt data (token-protected).
 * Roadmap: S3.7 · Spec: ARCHITECTURE.md §3.1, §6
 *
 * `?token=` is the authorisation — no session, because the link is meant to be forwarded to an
 * accountant. A wrong token and an unknown attempt give the same 404, so receipts cannot be enumerated.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { attemptId } = await params;
    const { token } = parseQuery(new URL(request.url).searchParams, receiptQueryInput);
    return json(await receipt(deps, attemptId, token));
  });
}
