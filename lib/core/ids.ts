/**
 * Shape checks for identifiers that arrive from a URL.
 * Roadmap: S3.3, S3.7 · Spec: ARCHITECTURE.md §6
 *
 * A `uuid` column makes Postgres *error* on garbage, and an error leaves as a 500 — which both breaks
 * the rule that an unknown id and a wrong credential answer identically, and tells a prober that the
 * route understood their input. Checking the shape first turns either into the same 404.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
