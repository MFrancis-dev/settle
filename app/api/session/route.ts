/**
 * POST /api/session — sign in with a NEP-413 signed message.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1, §5
 *
 * The only place Settle hands out a session cookie. The response body is deliberately small: the
 * cookie is the credential, and everything else comes from `GET /api/me`.
 */

import { clearSessionCookie } from "@/lib/server/session";
import { getServerDeps } from "@/lib/server/deps";
import { json, route } from "@/lib/server/http";
import { limitWrite, signInFromBody } from "@/lib/server/auth";

export async function POST(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    // S7.7: the limit runs before the signature does, so guessing nonces costs the caller a 429 and
    // Settle nothing.
    limitWrite(deps, "session", request);
    const signedIn = await signInFromBody(deps, request);

    return json(
      {
        nearAccountId: signedIn.user.nearAccountId,
        displayName: signedIn.user.displayName,
        isNew: signedIn.isNew,
      },
      { status: signedIn.isNew ? 201 : 200, headers: { "Set-Cookie": signedIn.cookie } },
    );
  });
}

/**
 * Signing out clears the cookie; an invalid or missing session is not an error here, because the
 * caller's goal (no session) is already true.
 */
export async function DELETE(): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    return json(
      { signedOut: true },
      { headers: { "Set-Cookie": clearSessionCookie({ secure: deps.secureCookies }) } },
    );
  });
}

