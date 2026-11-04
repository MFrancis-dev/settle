import { NextResponse } from "next/server";

/**
 * GET /api/me — profile + active payout destination.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function GET() {
  return NextResponse.json({ error: "Not implemented (S3.1)" }, { status: 501 });
}
