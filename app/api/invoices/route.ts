import { NextResponse } from "next/server";

/**
 * GET/POST /api/invoices — list / create.
 * Roadmap: S3.3 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function GET() {
  return NextResponse.json({ error: "Not implemented (S3.3)" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ error: "Not implemented (S3.3)" }, { status: 501 });
}
