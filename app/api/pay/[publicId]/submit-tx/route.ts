import { NextResponse } from "next/server";

/**
 * POST /api/pay/:publicId/submit-tx — forward tx hash to 1Click.
 * Roadmap: S3.6 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function POST() {
  return NextResponse.json({ error: "Not implemented (S3.6)" }, { status: 501 });
}
