/**
 * Session cookie issue/verify after NEP-413 sign-in; demo sessions.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §5, §6
 *
 * The cookie is an HMAC-signed payload, not a server-side store: the app is one Next.js process
 * plus a worker (SD-3), and a payment session has nothing to revoke mid-flight that a status
 * transition does not already handle. Signing is done with **Web Crypto**, because `middleware.ts`
 * runs on the Edge runtime where `node:crypto` does not exist — one implementation has to serve
 * both, so the codec is async.
 *
 * No `server-only` marker (same reason as `env-schema.ts`): it throws under plain Node and `tsx`,
 * which would break the worker, the seed scripts and the route tests that import this file.
 * Client components must still never import it — the secret would be a build error, not a leak.
 */

import { isDemoMode, parseEnv } from "./env-schema";

export const SESSION_COOKIE = "settle_session";

/** A payment can span a deadline of hours; a week outlives every flow in the PRD. */
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
  nearAccountId: string;
  /** Demo rows are flagged so a real payout can never be pointed at them. */
  isDemo: boolean;
  issuedAtMs: number;
}

export type SessionReason = "absent" | "malformed" | "unsigned" | "expired";

export class SessionRejection extends Error {
  constructor(readonly reason: SessionReason) {
    super(`session rejected: ${reason}`);
    this.name = "SessionRejection";
  }
}

export interface SessionCodec {
  issue(payload: Omit<SessionPayload, "issuedAtMs">): Promise<string>;
  read(cookieValue: string | null | undefined): Promise<SessionPayload>;
}

export interface SessionCodecOptions {
  secret: string;
  maxAgeSeconds?: number;
  now?: () => number;
}

/** TextEncoder/btoa exist in both the Edge and the Node runtimes; Buffer does not. */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const HMAC_PARAMS: HmacKeyGenParams & AlgorithmIdentifier = {
  name: "HMAC",
  hash: "SHA-256",
};

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytesOf(secret), HMAC_PARAMS, false, ["sign", "verify"]);
}

/**
 * Demo mode's fixed signing key, and the reason it is allowed to be fixed.
 *
 * The middleware that guards `/dashboard` runs on the Edge runtime and the route that issues the
 * demo cookie runs on Node: two runtimes, two module instances. A *random* per-process fallback is
 * therefore two different keys, and the cookie `/demo` hands out is rejected by the middleware on
 * the next navigation — the judge is bounced back to the landing page. One published key is what
 * makes the demo's sign-in hold across that boundary.
 *
 * Publishing it costs nothing because `demoModeConflict` (`lib/server/adapters.ts`) refuses to let
 * demo mode run next to `DATABASE_URL` or a public `https://` URL, so every session this key can
 * ever sign is for fictional rows on a local machine. Real mode is unaffected: `check-env` (#8)
 * requires `SESSION_SECRET`, and a real process without one falls back to the random key below
 * rather than to this one.
 */
export const DEMO_SESSION_SECRET = "settle-demo-session-secret-0123456789abcdef";

/**
 * A random key for a process that has no `SESSION_SECRET` and is not a demo: cookies cannot be
 * forged from outside it, they simply do not survive a restart, which is a loud failure rather than
 * a quiet one.
 */
let processSecret: string | null = null;

function randomProcessSecret(): string {
  if (processSecret === null) {
    processSecret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  }
  return processSecret;
}

/** The configured secret, or the fallback for a process that has none: demo's fixed key, else random. */
export function sessionSecretFrom(value: string | undefined, demo = false): string {
  if (value !== undefined) return value;
  return demo ? DEMO_SESSION_SECRET : randomProcessSecret();
}

export function sessionSecret(source: Record<string, string | undefined> = process.env): string {
  const env = parseEnv(source);
  return sessionSecretFrom(env.SESSION_SECRET, isDemoMode(env));
}

function parsePayload(json: unknown): SessionPayload | null {
  if (typeof json !== "object" || json === null) return null;
  const candidate = json as Record<string, unknown>;
  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.nearAccountId !== "string" ||
    typeof candidate.isDemo !== "boolean" ||
    typeof candidate.issuedAtMs !== "number"
  ) {
    return null;
  }
  return {
    userId: candidate.userId,
    nearAccountId: candidate.nearAccountId,
    isDemo: candidate.isDemo,
    issuedAtMs: candidate.issuedAtMs,
  };
}

export function createSessionCodec(options: SessionCodecOptions): SessionCodec {
  const maxAgeMs = (options.maxAgeSeconds ?? SESSION_MAX_AGE_S) * 1000;
  const now = options.now ?? Date.now;
  const keyPromise = importKey(options.secret);

  async function sign(body: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", await keyPromise, bytesOf(body));
    return toBase64Url(new Uint8Array(signature));
  }

  return {
    async issue(payload) {
      const body = toBase64Url(
        bytesOf(JSON.stringify({ ...payload, issuedAtMs: now() } satisfies SessionPayload)),
      );
      return `${body}.${await sign(body)}`;
    },

    async read(cookieValue) {
      if (cookieValue === null || cookieValue === undefined || cookieValue === "") {
        throw new SessionRejection("absent");
      }

      const separator = cookieValue.lastIndexOf(".");
      const body = cookieValue.slice(0, separator);
      const signature = cookieValue.slice(separator + 1);
      if (separator < 1 || signature.length === 0) throw new SessionRejection("malformed");

      let valid: boolean;
      try {
        valid = await crypto.subtle.verify(
          "HMAC",
          await keyPromise,
          fromBase64Url(signature),
          bytesOf(body),
        );
      } catch {
        // A signature that is not valid base64url is not a session, not a server error.
        throw new SessionRejection("malformed");
      }
      if (!valid) throw new SessionRejection("unsigned");

      let payload: SessionPayload | null;
      try {
        payload = parsePayload(JSON.parse(new TextDecoder().decode(fromBase64Url(body))));
      } catch {
        throw new SessionRejection("malformed");
      }
      if (payload === null) throw new SessionRejection("malformed");

      // `issuedAtMs` is inside the signed body, so a client cannot extend its own session.
      if (now() - payload.issuedAtMs > maxAgeMs) throw new SessionRejection("expired");
      return payload;
    },
  };
}

/** The keys are only asserted to exist so a stray `;` in a value cannot split a cookie. */
export function serializeSessionCookie(
  value: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds ?? SESSION_MAX_AGE_S}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** An expired cookie is how a browser deletes one; the value must still be present syntactically. */
export function clearSessionCookie(options: { secure: boolean }): string {
  return serializeSessionCookie("", { ...options, maxAgeSeconds: 0 });
}

function readCookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

/**
 * Read the session straight off a `Request`, so the same code runs in a route handler, in
 * middleware and in a test that builds `new Request(url, { headers })` without Next involved.
 */
export async function readSession(
  request: { headers: Headers },
  codec: SessionCodec,
): Promise<SessionPayload> {
  const value = readCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  return codec.read(value);
}

/** `PUBLIC_APP_URL` is the app's own identity, so it also decides whether cookies are `Secure`. */
export function isSecurePublicUrl(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return parseEnv(source).PUBLIC_APP_URL.startsWith("https://");
}

/** What a wallet signs for this app; `recipient` pins a message to one site (NEP-413 replay). */
export function expectedRecipient(
  source: Record<string, string | undefined> = process.env,
): string {
  return new URL(parseEnv(source).PUBLIC_APP_URL).host;
}
