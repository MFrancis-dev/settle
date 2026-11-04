import { NextResponse } from "next/server";

/**
 * PUT /api/payout — change payout destination (fresh NEP-413 required).
 * Roadmap: S3.2 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

export async function PUT() {
  return NextResponse.json({ error: "Not implemented (S3.2)" }, { status: 501 });
}
