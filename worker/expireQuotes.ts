/**
 * Every 60 s: past-deadline attempts with no deposit → expired.
 * Roadmap: S5.3 · Spec: ARCHITECTURE.md §3.4
 * Status: scaffold — not implemented yet.
 */

/** One tick of the loop. Pure-ish: all I/O comes through `deps` so tests can run a single tick. */
export async function expireQuotes(_deps: unknown): Promise<void> {
  // TODO(S5.3)
}
