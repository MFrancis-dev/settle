import { submitTxInput } from "@/lib/core/schemas";
import { getServerDeps } from "@/lib/server/deps";
import { clientIp, json, parseJsonBody, route } from "@/lib/server/http";
import { submitTx } from "@/lib/server/pay";

/**
 * POST /api/pay/:publicId/submit-tx — forward tx hash to 1Click.
 * Roadmap: S3.6 · Spec: ARCHITECTURE.md §3.1, §3.4
 *
 * An optimisation, not a state change: 1Click finds the deposit by watching the address anyway. That
 * is why a transport failure answers 200 with `forwarded: false` — the money really did leave the
 * payer's wallet, and a retry here would only add load.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { publicId } = await params;
    const input = await parseJsonBody(request, submitTxInput);
    return json(await submitTx(deps, { publicId, ip: clientIp(request), input }));
  });
}
