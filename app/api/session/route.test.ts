import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Roadmap: S3.1, S3.8 · happy path + validation + auth for `POST /api/session` and `GET /api/me`
import { DELETE, POST } from "./route";
import { GET as GET_ME } from "../me/route";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE } from "@/lib/server/session";
import { errorOf, jsonOf, apiRequest, createRouteHarness, signClaims, signInBody, type RouteHarness, type Signer } from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;
let signer: Signer;

beforeAll(async () => {
  harness = await createRouteHarness();
  signer = harness.newSigner();
});

afterAll(async () => {
  await harness?.close();
});

describe("POST /api/session", () => {
  it("signs a first-time account in and sets the session cookie", async () => {
    const response = await POST(apiRequest("/api/session", { body: signInBody(signer) }));
    const body = await jsonOf(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({ nearAccountId: signer.accountId, displayName: signer.accountId, isNew: true });
    expect(response.headers.get("Set-Cookie")).toMatch(/^settle_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=604800");
  });

  it("signs a returning account in again without creating a second user", async () => {
    const account = harness.newSigner();
    const first = await POST(apiRequest("/api/session", { body: signInBody(account) }));
    const second = await POST(apiRequest("/api/session", { body: signInBody(account) }));

    expect(first.status).toBe(201);
    expect(await jsonOf(first)).toMatchObject({ nearAccountId: account.accountId, isNew: true });
    expect(second.status).toBe(200);
    expect(await jsonOf(second)).toMatchObject({ nearAccountId: account.accountId, isNew: false });

    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.nearAccountId, account.accountId));
    expect(rows).toHaveLength(1);
  });

  it("refuses a body that is not JSON", async () => {
    const response = await POST(
      new Request("http://settle.test/api/session", { method: "POST", body: "hello" }),
    );

    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_request");
  });

  it("refuses the eleventh sign-in from one caller in a minute, before doing any signature work (S7.7)", async () => {
    const ip = "198.51.100.7";
    const statuses: number[] = [];

    // The body would fail validation anyway. What comes back on the eleventh call is the limiter's
    // 429 rather than the 400, which is the point: a caller guessing signatures is refused without
    // Settle parsing the body, checking the nonce or reading the NEAR RPC.
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await POST(apiRequest("/api/session", { body: { message: "not a sign-in" }, ip }));
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 400));
    expect(statuses[10]).toBe(429);
    expect((await errorOf(await POST(apiRequest("/api/session", { body: {}, ip })))).code).toBe("rate_limited");
  });

  it("refuses a signed message from a key the account does not own", async () => {
    const stranger = harness.foreignSigner();
    const response = await POST(apiRequest("/api/session", { body: signInBody(stranger) }));

    expect(response.status).toBe(401);
    expect(await errorOf(response)).toMatchObject({ code: "unauthorized", details: { reason: "signature_mismatch" } });
  });

  it("refuses a message addressed to another site", async () => {
    const response = await POST(
      apiRequest("/api/session", {
        body: {
          ...signClaims(harness.newSigner(), { message: "Settle sign-in", recipient: "evil.example" }),
          accountId: "x.testnet",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect((await errorOf(response)).details).toEqual({ reason: "recipient_mismatch" });
  });

  it("refuses a captured sign-in body replayed a second time", async () => {
    const replayed = harness.newSigner();
    const body = signInBody(replayed);

    expect((await POST(apiRequest("/api/session", { body }))).status).toBe(201);
    const second = await POST(apiRequest("/api/session", { body }));

    expect(second.status).toBe(401);
    expect((await errorOf(second)).details).toEqual({ reason: "replayed" });
  });

  it("does not set a cookie when the signature is rejected", async () => {
    const response = await POST(apiRequest("/api/session", { body: signInBody(harness.foreignSigner()) }));

    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("DELETE /api/session", () => {
  it("clears the cookie whether or not a session was present", async () => {
    const response = await DELETE();
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("settle_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(await jsonOf(response)).toEqual({ signedOut: true });
  });
});

describe("GET /api/me", () => {
  it("rejects a request with no session", async () => {
    const response = await GET_ME(apiRequest("/api/me"));

    expect(response.status).toBe(401);
    expect((await errorOf(response)).details).toBeUndefined();
  });

  it("rejects a forged session cookie", async () => {
    const response = await GET_ME(apiRequest("/api/me", { cookie: "settle_session=YWJj.ZGVm" }));

    expect(response.status).toBe(401);
    expect((await errorOf(response)).message).toContain("No valid session (unsigned)");
  });

  it("returns the profile and the default payout destination", async () => {
    const account = harness.newSigner();
    const cookie = await harness.cookieFor(account);
    const body = await jsonOf(await GET_ME(apiRequest("/api/me", { cookie })));

    expect(body.nearAccountId).toBe(account.accountId);
    expect(body.displayName).toBe(account.accountId);
    expect(body.isDemo).toBe(false);
    expect(body.payout).toMatchObject({ chain: "near", address: account.accountId, active: true });
    expect(body.payout).toMatchObject({ assetSymbol: "USDC", decimals: 6 });
  });

  it("refuses a session whose user row no longer exists", async () => {
    // A signature and a still-valid session are not enough: the account has to exist right now.
    const orphaned = await harness.deps.sessions.issue({
      userId: "00000000-0000-4000-8000-000000000000",
      nearAccountId: "deleted-account.testnet",
      isDemo: false,
    });

    const response = await GET_ME(
      apiRequest("/api/me", { cookie: `${SESSION_COOKIE}=${encodeURIComponent(orphaned)}` }),
    );

    expect(response.status).toBe(401);
    expect((await errorOf(response)).message).toContain("no longer matches an account");
  });

  it("never includes the session secret or a signature", async () => {
    const cookie = await harness.cookieFor(harness.newSigner());
    const text = await (await GET_ME(apiRequest("/api/me", { cookie }))).text();

    expect(text).not.toContain("settle-test-session-secret");
    expect(text).not.toContain("ed25519:");
  });
});
