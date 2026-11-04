/**
 * Every 5 s: non-terminal attempts → /v0/status → update attempt + invoice.
 * Roadmap: S5.2 · Spec: ARCHITECTURE.md §3.4
 * Status: scaffold — not implemented yet.
 */

/** One tick of the loop. Pure-ish: all I/O comes through `deps` so tests can run a single tick. */
export async function pollPayments(_deps: unknown): Promise<void> {
  // TODO(S5.2)
}
