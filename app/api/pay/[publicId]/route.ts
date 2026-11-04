import { NextResponse } from "next/server";

/**
 * GET /api/pay/:publicId — public invoice view.
 * Roadmap: S3.4 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function GET() {
  return NextResponse.json({ error: "Not implemented (S3.4)" }, { status: 501 });
}
