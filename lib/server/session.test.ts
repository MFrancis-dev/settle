import { describe, expect, it } from "vitest";

// Roadmap: S3.8
import {
  DEMO_SESSION_SECRET,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  SessionRejection,
  clearSessionCookie,
  createSessionCodec,
  expectedRecipient,
  isSecurePublicUrl,
  readSession,
  serializeSessionCookie,
  sessionSecret,
  sessionSecretFrom,
} from "./session";

const SECRET = "settle-test-session-secret-0123456789abcdef";
const PAYLOAD = { userId: "user-1", nearAccountId: "alice.testnet", isDemo: false };

function codecAt(nowMs: number) {
  return createSessionCodec({ secret: SECRET, now: () => nowMs });
}

describe("session: cookie codec", () => {
  it("round-trips a payload it issued", async () => {
    const codec = codecAt(1_730_000_000_000);
    const value = await codec.issue(PAYLOAD);
    const read = await codec.read(value);

    expect(read).toEqual({ ...PAYLOAD, issuedAtMs: 1_730_000_000_000 });
  });

  it("rejects a cookie signed by a different secret", async () => {
    const value = await codecAt(1_730_000_000_000).issue(PAYLOAD);
    const other = createSessionCodec({ secret: `${SECRET}-other`, now: () => 1_730_000_000_000 });

    await expect(other.read(value)).rejects.toThrowError(SessionRejection);
    await expect(other.read(value)).rejects.toMatchObject({ reason: "unsigned" });
  });

  it("rejects a payload edited after signing", async () => {
    const value = await codecAt(1_730_000_000_000).issue(PAYLOAD);
    const signature = value.split(".")[1];
    // `isDemo: true` for a user who is not a demo: the body changes, so the signature stops matching.
    const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, isDemo: true }), "utf8").toString("base64url");

    await expect(codecAt(1_730_000_000_000).read(`${forged}.${signature}`)).rejects.toMatchObject({
      reason: "unsigned",
    });
  });

  it("separates absent, malformed and unsigned", async () => {
    const codec = codecAt(1_730_000_000_000);

    await expect(codec.read(null)).rejects.toMatchObject({ reason: "absent" });
    await expect(codec.read("")).rejects.toMatchObject({ reason: "absent" });
    await expect(codec.read("no-separator-here")).rejects.toMatchObject({ reason: "malformed" });
    await expect(codec.read(".")).rejects.toMatchObject({ reason: "malformed" });
    // A signature that is not base64 at all cannot even be compared.
    await expect(codec.read("abc.@@@")).rejects.toMatchObject({ reason: "malformed" });
    // Well-formed base64 that is simply not the right signature: still not a session.
    await expect(codec.read("YWJj.ZGVm")).rejects.toMatchObject({ reason: "unsigned" });
  });

  it("expires at the boundary and not before", async () => {
    const issued = await codecAt(1_000).issue(PAYLOAD);
    const within = createSessionCodec({ secret: SECRET, maxAgeSeconds: 60, now: () => 60_000 });
    const after = createSessionCodec({ secret: SECRET, maxAgeSeconds: 60, now: () => 62_000 });

    await expect(within.read(issued)).resolves.toMatchObject({ userId: "user-1" });
    await expect(after.read(issued)).rejects.toMatchObject({ reason: "expired" });
  });
});

describe("session: cookie attributes", () => {
  it("is HttpOnly, SameSite=Lax, path-rooted and expires", () => {
    const cookie = serializeSessionCookie("abc.def", { secure: true });
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
    expect(cookie).toContain("Secure");
  });

  it("leaves plain http without Secure, so localhost still sets the cookie", () => {
    expect(serializeSessionCookie("abc.def", { secure: false })).not.toContain("Secure");
  });

  it("escapes a value containing characters a cookie header cannot carry raw", () => {
    expect(serializeSessionCookie("a b;c", { secure: false })).toContain("a%20b%3Bc");
  });

  it("clears by expiring, with a value present so the attribute set stays valid", () => {
    const cleared = clearSessionCookie({ secure: true });
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain(`${SESSION_COOKIE}=`);
  });
});

describe("session: reading from a request", () => {
  const cookieHeaderFor = (value: string) =>
    new Headers({ cookie: `other=1; ${SESSION_COOKIE}=${encodeURIComponent(value)}; theme=dark` });

  it("picks the session cookie out of a multi-cookie header", async () => {
    const codec = codecAt(1_000);
    const value = await codec.issue(PAYLOAD);
    const request = { headers: cookieHeaderFor(value) };

    await expect(readSession(request, codec)).resolves.toMatchObject({ nearAccountId: "alice.testnet" });
  });

  it("throws `absent` when the header has no session cookie", async () => {
    await expect(readSession({ headers: new Headers({ cookie: "theme=dark" }) }, codecAt(1)))
      .rejects.toMatchObject({ reason: "absent" });
  });

  it("throws `absent` when there is no cookie header at all", async () => {
    await expect(readSession({ headers: new Headers() }, codecAt(1))).rejects.toMatchObject({
      reason: "absent",
    });
  });
});

describe("session: secret and origin", () => {
  it("reads the configured secret from the env schema", () => {
    expect(sessionSecret({ SESSION_SECRET: SECRET })).toBe(SECRET);
  });

  it("falls back to a per-process key when no secret is configured", () => {
    const first = sessionSecretFrom(undefined);
    expect(first.length).toBeGreaterThanOrEqual(32);
    // Same process, same key: a session must survive a second request after the first.
    expect(sessionSecretFrom(undefined)).toBe(first);
    // A real process with no `SESSION_SECRET` must not get the published demo key (#8 forces the
    // real value; until then the fallback stays unforgeable from outside the process).
    expect(first).not.toBe(DEMO_SESSION_SECRET);
  });

  it("gives demo mode one fixed key, so the Edge middleware and a Node route agree", async () => {
    expect(sessionSecretFrom(undefined, true)).toBe(DEMO_SESSION_SECRET);
    expect(sessionSecret({ DEMO_MODE: "1", PUBLIC_APP_URL: "http://localhost:3000" })).toBe(
      DEMO_SESSION_SECRET,
    );

    // The bug this pins down: two runtimes build their own codec. With a random fallback the cookie
    // one of them signed was rejected by the other, and `/demo` could not reach `/dashboard`.
    const edge = createSessionCodec({ secret: sessionSecret({ DEMO_MODE: "1" }) });
    const node = createSessionCodec({ secret: sessionSecretFrom(undefined, true) });
    const cookie = await edge.issue({ ...PAYLOAD, nearAccountId: "ada.demo.near", isDemo: true });
    await expect(node.read(cookie)).resolves.toMatchObject({
      nearAccountId: "ada.demo.near",
      isDemo: true,
    });
  });

  it("decides `Secure` from the public origin", () => {
    expect(isSecurePublicUrl({ PUBLIC_APP_URL: "https://settle.app" })).toBe(true);
    expect(isSecurePublicUrl({ PUBLIC_APP_URL: "http://localhost:3000" })).toBe(false);
  });

  it("pins NEP-413 `recipient` to the origin host, not the whole URL", () => {
    expect(expectedRecipient({ PUBLIC_APP_URL: "https://settle.app:8443/base" })).toBe("settle.app:8443");
    expect(expectedRecipient({ PUBLIC_APP_URL: "http://localhost:3000" })).toBe("localhost:3000");
  });
});
