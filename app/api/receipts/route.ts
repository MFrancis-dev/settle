import { receiptQueryInput } from "@/lib/core/schemas";
import { getServerDeps } from "@/lib/server/deps";
import { json, parseQuery, route } from "@/lib/server/http";
import { receiptByToken } from "@/lib/server/receipts";

/**
 * GET /api/receipts?token=… — the receipt behind a bare `/receipt/<token>` link.
 * Roadmap: S3.7, S4.6 · Spec: PRD FR-18
 *
 * The sibling `GET /api/receipts/:attemptId` is what every link the app generates uses. This is the
 * fallback for a link that arrives without its `?attempt=` — copied out of the dashboard, trimmed by
 * an email client — where the token on its own has to be enough. `receipt_token` is unique and
 * unguessable, so it authorises exactly one attempt and no other invoice; an unknown token answers
 * the same 404 as that route, so neither endpoint can be used to enumerate payments.
 */
export async function GET(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { token } = parseQuery(new URL(request.url).searchParams, receiptQueryInput);
    return json(await receiptByToken(deps, token));
  });
}
