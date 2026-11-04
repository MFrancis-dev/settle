import { NextResponse } from "next/server";

/**
 * GET /api/pay/:publicId/status — current attempt status.
 * Roadmap: S3.6 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function GET() {
  return NextResponse.json({ error: "Not implemented (S3.6)" }, { status: 501 });
}
