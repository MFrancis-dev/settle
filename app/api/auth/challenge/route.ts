import { challengeQueryInput } from "@/lib/core/schemas";
import { signInMessage } from "@/lib/core/sign-in-message";
import { getServerDeps } from "@/lib/server/deps";
import { CHALLENGE_TTL_MS } from "@/lib/server/nonces";
import { clientIp, json, parseQuery, route } from "@/lib/server/http";
import { limit } from "@/lib/server/rateLimit";

/**
 * GET /api/auth/challenge?intent=session|payout — mint a server-issued NEP-413 nonce (#109).
 * Roadmap: S7.12 · Spec: ARCHITECTURE.md §5, §6
 *
 * This is what makes sign-in and payout freshness the *server's* promise rather than the wallet's.
 * The client can no longer bring its own nonce: it signs the one returned here, and `verifySigned`
 * accepts only a nonce this process issued and has not spent — so a sign-in body captured before it
 * was ever submitted dies when its window passes, instead of buying a session forever.
 *
 * Two guards keep it from becoming a tool for anything else:
 * - it only ever hands back one of two fixed strings (`signInMessage`, or nothing for a payout) plus
 *   a random nonce. It signs nothing and echoes no caller text, so it is not an oracle for arbitrary
 *   messages; and
 * - it is rate limited per caller (`CHALLENGE_LIMIT`), so pre-minting a stock of nonces is capped.
 *
 * The nonce is not a credential: it is meaningless without the account's own wallet signature over
 * it, which is why this endpoint is unauthenticated.
 */
export async function GET(request: Request): Promise<Response> {
  return route(async () => {
    const deps = await getServerDeps();
    const { intent } = parseQuery(new URL(request.url).searchParams, challengeQueryInput);
    limit(deps.challengeLimits, `challenge:${clientIp(request)}`);

    const nonce = deps.nonces.issue();
    return json({
      intent,
      nonce,
      recipient: deps.expectedRecipient,
      // A sign-in dialog names the host; a payout dialog is the destination string the client builds,
      // so there is no message for this endpoint to supply (and none to be abused).
      message: intent === "session" ? signInMessage(deps.expectedRecipient) : null,
      expiresAt: new Date(deps.now() + CHALLENGE_TTL_MS).toISOString(),
    });
  });
}
