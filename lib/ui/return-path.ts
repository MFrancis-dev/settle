/**
 * The `?next=` a signed-out visitor is sent back to after signing in.
 * Roadmap: S4.1, S4.8 · Spec: ARCHITECTURE.md §5 (middleware is a convenience, not the boundary)
 *
 * `middleware.ts` puts the path somebody asked for in the query, and the landing page hands it to
 * `router.push`. That makes the query a URL written by somebody else and executed by the app, so it is
 * checked here: only a path inside the signed-in app comes back, and `//host` / `/\host` — which the
 * router reads as another origin — are dropped rather than followed.
 */

/** The paths `middleware.ts` guards, and therefore the only ones it can send somebody back to. */
const GATED = ["/dashboard", "/invoices", "/settings"];

export function returnPath(next: string | string[] | undefined): string | null {
  const value = Array.isArray(next) ? next[0] : next;
  if (value === undefined) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  const inside = GATED.some(
    (prefix) =>
      value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`),
  );
  return inside ? value : null;
}
