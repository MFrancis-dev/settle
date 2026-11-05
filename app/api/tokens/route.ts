import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { tokenList } from "@/lib/server/pay";

/**
 * GET /api/tokens — cached 1Click token list.
 * Roadmap: S3.4 · Spec: ARCHITECTURE.md §3.1, §8
 *
 * Public and short-cached so no page hardcodes an asset id or a decimal count. When 1Click is down
 * this is a 502 rather than an empty list: "we do not know" must not read as "nothing is supported".
 */

export async function GET(): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    return json(await tokenList(deps));
  });
}
