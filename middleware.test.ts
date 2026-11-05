import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

// Roadmap: S3.1, S3.8 · the middleware is a convenience gate: it redirects, the routes authorise.
import { middleware, config } from "./middleware";
import { SESSION_COOKIE, createSessionCodec, serializeSessionCookie, sessionSecret } from "@/lib/server/session";

const PAYLOAD = { userId: "user-1", nearAccountId: "seller.testnet", isDemo: false };

async function cookieFor(options: { ageMs?: number } = {}): Promise<string> {
  const aged = createSessionCodec({
    secret: sessionSecret(),
    now: () => Date.now() - (options.ageMs ?? 0),
  });
  return serializeSessionCookie(await aged.issue(PAYLOAD), { secure: false }).split(";")[0] as string;
}

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://settle.test${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** Where a rejected visitor is sent: the landing page, with the path they asked for in `?next=`. */
function redirectTo(response: Response): URL {
  return new URL(response.headers.get("location") ?? "");
}

describe("middleware", () => {
  it("lets a signed-in visitor through untouched", async () => {
    const response = await middleware(request("/dashboard", await cookieFor()));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends a signed-out visitor to the landing page and remembers where they wanted to go", async () => {
    const response = await middleware(request("/settings"));
    const target = redirectTo(response);

    expect(response.status).toBe(307);
    expect(target.pathname).toBe("/");
    expect(target.searchParams.get("next")).toBe("/settings");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("treats a forged cookie exactly like no cookie", async () => {
    const valid = await cookieFor();
    const forged = `${valid.slice(0, valid.length - 2)}xx`;

    const response = await middleware(request("/dashboard", forged));

    expect(response.status).toBe(307);
    expect(redirectTo(response).searchParams.get("next")).toBe("/dashboard");
  });

  it("rejects a session older than the cookie's own lifetime", async () => {
    const ancient = await cookieFor({ ageMs: 8 * 24 * 60 * 60 * 1000 });

    expect((await middleware(request("/invoices", ancient))).status).toBe(307);
  });

  it("gates only the app pages: a pay link and a receipt stay reachable without a session", () => {
    // the matcher is the boundary; widening it by one segment would lock clients out of their own
    // invoices, which is the opposite of §3.1
    expect(config.matcher).toEqual(["/dashboard/:path*", "/invoices/:path*", "/settings/:path*"]);
  });
});
