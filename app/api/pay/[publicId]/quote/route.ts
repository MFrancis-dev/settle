import { payQuoteInput } from "@/lib/core/schemas";
import { getServerDeps } from "@/lib/server/deps";
import { clientIp, json, parseJsonBody, route } from "@/lib/server/http";
import { quote } from "@/lib/server/pay";

/**
 * POST /api/pay/:publicId/quote — dry preview or real attempt (one active).
 * Roadmap: S3.5 · Spec: ARCHITECTURE.md §3.1, §3.2, §6
 *
 * The only public route that writes. Every rule that keeps a client from paying twice, or from
 * choosing where the seller gets paid, lives in `lib/server/pay.ts`; this file only reads the body
 * and the caller's address for the rate limit.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { publicId } = await params;
    const input = await parseJsonBody(request, payQuoteInput);
    return json(await quote(deps, { publicId, ip: clientIp(request), input }));
  });
}
