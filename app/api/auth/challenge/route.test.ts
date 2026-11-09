import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Roadmap: S7.12 · the mint behind #109: freshness has to be the server's promise, so what this route
// hands out has to be the only thing `verifySigned` will spend.
import { GET } from "./route";
import { signInMessage } from "@/lib/core/sign-in-message";
import { CHALLENGE_TTL_MS } from "@/lib/server/nonces";
import { APP_RECIPIENT, APP_ORIGIN } from "@/lib/server/__fixtures__/routes";
import {
  apiRequest,
  createRouteHarness,
  errorOf,
  issuesOf,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

beforeAll(async () => {
  harness = await createRouteHarness();
});

afterAll(async () => {
  await harness?.close();
});

function challenge(intent: string, options: { ip?: string } = {}): Promise<Response> {
  return GET(apiRequest(`/api/auth/challenge?intent=${intent}`, options));
}

async function minted(intent: "session" | "payout"): Promise<string> {
  const body = await jsonOf(await challenge(intent));
  return body.nonce as string;
}

describe("GET /api/auth/challenge", () => {
  it("needs no session — the nonce means nothing without the account's own signature", async () => {
    const response = await challenge("session");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("names the host and the message a sign-in has to sign", async () => {
    const body = await jsonOf(await challenge("session"));

    expect(body).toMatchObject({
      intent: "session",
      recipient: APP_RECIPIENT,
      message: signInMessage(APP_RECIPIENT),
    });
    expect(Buffer.from(body.nonce as string, "base64")).toHaveLength(32);
    expect(new Date(body.expiresAt as string).getTime()).toBe(
      harness.deps.now() + CHALLENGE_TTL_MS,
    );
  });

  it("supplies no message for a payout, whose dialog text is the destination the client typed", async () => {
    const body = await jsonOf(await challenge("payout"));

    expect(body).toMatchObject({ intent: "payout", message: null });
    expect(body.nonce).toBeTruthy();
  });

  it("mints a different nonce every time", async () => {
    const nonces = await Promise.all(
      Array.from({ length: 8 }, async () => (await jsonOf(await challenge("session"))).nonce),
    );

    expect(new Set(nonces).size).toBe(8);
  });

  it("hands out a nonce that is spendable exactly once", async () => {
    const nonce = await minted("session");

    expect(harness.deps.nonces.use(nonce)).toBe(true);
    expect(harness.deps.nonces.use(nonce)).toBe(false);
  });

  it("spends no earlier challenge when it mints a new one", async () => {
    const first = await minted("session");
    await minted("session");

    // Two tabs can hold a challenge each; the second sign-in must not silently consume the first.
    expect(harness.deps.nonces.use(first)).toBe(true);
  });

  it("ages the challenge out at exactly the window it advertised", async () => {
    const nonce = await minted("session");
    harness.advance(CHALLENGE_TTL_MS);

    // Past `expiresAt` a captured body is worthless, which is the whole point of issuing server-side.
    expect(harness.deps.nonces.use(nonce)).toBe(false);
  });

  it("refuses an intent it does not know instead of defaulting to one", async () => {
    const response = await challenge("anything-goes");
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(issuesOf(error)).toEqual([{ path: "intent", message: expect.any(String) }]);
  });

  it("refuses a request with no intent", async () => {
    expect((await GET(apiRequest("/api/auth/challenge"))).status).toBe(400);
  });

  it("echoes nothing back: only the two fixed strings and a nonce leave this route", async () => {
    const text = await (
      await GET(
        apiRequest(`/api/auth/challenge?intent=session&message=${encodeURIComponent("hack me")}`),
      )
    ).text();

    expect(text).not.toContain("hack me");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      ["expiresAt", "intent", "message", "nonce", "recipient"].sort(),
    );
  });

  it("caps one caller at a minute's worth of challenges (S7.7)", async () => {
    const ip = "198.51.100.22";
    const statuses: number[] = [];

    for (let call = 0; call < 31; call += 1) {
      statuses.push((await challenge("session", { ip })).status);
    }

    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 200));
    expect(statuses[30]).toBe(429);
    expect(await errorOf(await challenge("session", { ip }))).toMatchObject({
      code: "rate_limited",
    });

    // A different caller is unaffected: the mint is keyed per address, not globally.
    expect((await challenge("session", { ip: "198.51.100.23" })).status).toBe(200);
  });

  it("does not leak the app origin into the answer", async () => {
    const body = await jsonOf(await challenge("session"));

    // `recipient` is the host the wallet signs, taken from the server's own config rather than the
    // request, so a caller cannot aim a captured signature at a different origin.
    expect(body.recipient).toBe(new URL(APP_ORIGIN).host);
  });
});
