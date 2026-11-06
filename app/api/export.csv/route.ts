import { getServerDeps } from "@/lib/server/deps";
import { route } from "@/lib/server/http";
import { requireSession, limitWrite } from "@/lib/server/auth";
import { assertNotDemo, exportCsv } from "@/lib/server/invoices";

/**
 * GET /api/export.csv — accountant CSV.
 * Roadmap: S3.7 · Spec: ARCHITECTURE.md §3.1, §7
 *
 * Session-only, and a demo account is refused: seeded data must not leave the app looking like a real
 * ledger. CRLF endings and doubled quotes come from `lib/server/invoices.ts`, so an error from that
 * layer still answers in the JSON error shape rather than as broken CSV.
 */

export async function GET(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const principal = await requireSession(deps, request);
    assertNotDemo(principal);
    // S7.7: an export reads every invoice and every attempt of an account, so it is the one read
    // worth a bucket of its own.
    limitWrite(deps, "export", request, principal.user.id);

    const stamp = new Date(deps.now()).toISOString().slice(0, 10);
    return new Response(await exportCsv(deps, principal), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="settle-ledger-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
}
