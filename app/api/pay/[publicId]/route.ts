import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { publicInvoice } from "@/lib/server/pay";

/**
 * GET /api/pay/:publicId — public invoice view.
 * Roadmap: S3.4 · Spec: ARCHITECTURE.md §3.1, §6
 *
 * No session, no guessable id: `publicId` is the capability. The seller's payout address and any
 * refund address are absent from this body — a client needs the amount, who is asking, and their own
 * deposit address.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { publicId } = await params;
    return json(await publicInvoice(deps, publicId));
  });
}
