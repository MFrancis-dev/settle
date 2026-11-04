import { NextResponse } from "next/server";

/**
 * POST /api/invoices/:id/cancel — cancel if unpaid.
 * Roadmap: S3.3 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function POST() {
  return NextResponse.json({ error: "Not implemented (S3.3)" }, { status: 501 });
}
