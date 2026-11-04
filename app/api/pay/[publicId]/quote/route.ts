import { NextResponse } from "next/server";

/**
 * POST /api/pay/:publicId/quote — dry preview or real attempt (one active).
 * Roadmap: S3.5 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function POST() {
  return NextResponse.json({ error: "Not implemented (S3.5)" }, { status: 501 });
}
