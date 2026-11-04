import { NextResponse } from "next/server";

/**
 * GET /api/tokens — cached 1Click token list.
 * Roadmap: S3.4 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function GET() {
  return NextResponse.json({ error: "Not implemented (S3.4)" }, { status: 501 });
}
