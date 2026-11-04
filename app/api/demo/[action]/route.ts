import { NextResponse } from "next/server";

/**
 * POST /api/demo/:action — simulate-payment, reset (demo sessions only).
 * Roadmap: S6.4 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function POST() {
  return NextResponse.json({ error: "Not implemented (S6.4)" }, { status: 501 });
}
