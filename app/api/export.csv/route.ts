import { NextResponse } from "next/server";

/**
 * GET /api/export.csv — accountant CSV.
 * Roadmap: S3.7 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function GET() {
  return NextResponse.json({ error: "Not implemented (S3.7)" }, { status: 501 });
}
