/**
 * Redirects signed-out users away from (dashboard) routes.
 * Roadmap: S3.1 / K4.1 · Spec: ARCHITECTURE.md §3.1, §5
 *
 * Middleware is a *convenience* layer here, not the security boundary: every `/api/me`, `/api/payout`
 * and `/api/invoices` handler re-reads and re-verifies the same cookie (`requireSession`). That is
 * deliberate — the Edge runtime cannot reach the database, so a route can never assume this file ran,
 * and a redirect that only hides a page would be the kind of control that breaks under a direct fetch.
 *
 * A valid session is a valid session, demo or real: `isDemo` changes what a route will do, not whether
 * the visitor is signed in (AGENTS.md §6).
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  clearSessionCookie,
  createSessionCodec,
  readSession,
  sessionSecret,
  type SessionCodec,
} from "@/lib/server/session";

/**
 * The HMAC key import is the only async setup, so it is reused across requests — but keyed on the
 * secret value, so a rotated `SESSION_SECRET` takes effect on the next request instead of being
 * pinned to the first one this process served.
 */
let cached: { secret: string; codec: SessionCodec } | null = null;

function edgeCodec(secret: string): SessionCodec {
  if (cached?.secret !== secret) cached = { secret, codec: createSessionCodec({ secret }) };
  return cached.codec;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  try {
    await readSession(request, edgeCodec(sessionSecret()));
    return NextResponse.next();
  } catch {
    // Any rejection — absent, forged, malformed or expired — goes to the landing page, which holds
    // the sign-in call to action. The intended path travels as a query so the UI can return you.
    const signIn = new URL("/", url);
    signIn.searchParams.set("next", url.pathname);
    const redirect = NextResponse.redirect(signIn);
    // A cookie that failed verification is not a session; clearing it stops a corrupt value from
    // shadowing the next sign-in.
    redirect.headers.append(
      "Set-Cookie",
      clearSessionCookie({ secure: url.protocol === "https:" }),
    );
    return redirect;
  }
}

/**
 * Only the signed-in app pages. `/pay/*`, `/receipt/*`, `/demo` and `/api/*` stay outside: the pay
 * page is public by design, a receipt link is authorised by its own token, and API routes answer for
 * themselves.
 */
export const config = {
  matcher: ["/dashboard/:path*", "/invoices/:path*", "/settings/:path*"],
};
