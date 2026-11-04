import { NextResponse } from "next/server";

/**
 * POST /api/session — sign in with a NEP-413 signed message.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function POST() {
  return NextResponse.json({ error: "Not implemented (S3.1)" }, { status: 501 });
}
