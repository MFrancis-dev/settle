/**
 * Test-only wiring for the API routes: an in-memory database, real ed25519 signatures, a scripted
 * 1Click, and a fixed clock.
 * Roadmap: S3.8 · AGENTS.md §8 — no network, no hosted database, and no mocking of Settle's own code.
 *
 * Everything below is a *real* implementation of a boundary: the signatures are signed with
 * `@noble/curves` and verified by `verifyNep413`; the 1Click stub answers with fixtures signed by the
 * throwaway manager key, so `verifyQuoteSignature` genuinely passes or fails. Only the outside world
 * is substituted — which is why a route test can call the exported `GET`/`POST` of a `route.ts` file
 * and get the deployed behaviour.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";

import tokensFixture from "../../oneclick/__fixtures__/tokens.json";
import { TEST_MANAGER_PUBLIC_KEY, signFixture, tamperAmountOut } from "../../oneclick/__fixtures__/signing";
import type { ConnectedDatabase, PgliteDb } from "../../db/client";
import { nextAccountId, openTestDatabase } from "../../db/__fixtures__/testdb";
import { createInvoice } from "../../db/queries/invoices";
import { setActiveDestination } from "../../db/queries/payoutDestinations";
import { findUserByNearAccount } from "../../db/queries/users";
import type { FetchLike } from "../../oneclick/client";
import { serializeNep413Payload } from "../../near/nep413";
import type { SignedMessageFields } from "../../core/schemas";
import { payoutMessage } from "../../core/payout-message";
import { parseEnv } from "../env-schema";
import { clearServerDeps, createServerDeps, installServerDeps, type ServerDeps } from "../deps";
import { signIn } from "../auth";

/** Frozen so a quote deadline, a session age and a CSV filename are all predictable. */
export const TEST_NOW_MS = Date.parse("2026-11-05T09:00:00Z");

/** The app's own origin; `recipient` in a NEP-413 message is pinned to its host. */
export const APP_ORIGIN = "http://settle.test";
export const APP_RECIPIENT = "settle.test";

const TEST_ENV = parseEnv({
  SESSION_SECRET: "settle-test-session-secret-0123456789abcdef",
  PUBLIC_APP_URL: APP_ORIGIN,
  ONECLICK_MANAGER_PUBLIC_KEY: TEST_MANAGER_PUBLIC_KEY,
  ONECLICK_JWT: "test-partner-jwt",
});

/** The USDC-on-NEAR asset the token fixture lists; `signIn` seeds it as the default destination. */
export const USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** A stable client address for the per-IP rate limiter; tests that need a second caller pass their own. */
export const CLIENT_IP = "203.0.113.10";

export interface Signer {
  accountId: string;
  /** `ed25519:…`, the form both the RPC and `verifyNep413` use. */
  publicKey: string;
  secret: Uint8Array;
}

export interface StubCall {
  path: string;
  body: unknown;
  /** The URL's query string — where a GET carries its deposit address and memo. */
  query: Record<string, string>;
}

export interface OneClickStub {
  fetch: FetchLike;
  calls: StubCall[];
  /** Bodies for `/v0/status`; `null` answers 404 the way the service does for an unknown deposit. */
  statuses(...bodies: (unknown | null)[]): void;
  /** Replace `/v0/tokens` wholesale, e.g. with `[]` to prove the registry refuses an empty list. */
  tokens(body: unknown): void;
  /** Replace the quote answer, e.g. with an unsigned body or a 400. */
  quote(handler: ((body: unknown) => Response) | null): void;
  /** Answer every quote with a body whose signature does not match its own amounts. */
  tamperedQuote(): void;
  /** Answer the next call to `path` with this status, for the upstream-failure branches. */
  failOnce(path: string, status: number, body?: unknown): void;
  quoteRequests(): unknown[];
  reset(): void;
}

export interface SeededInvoice {
  userId: string;
  publicId: string;
  invoiceId: string;
  /** Base-unit string, so a test can compare against the exact number the quote must carry. */
  total: string;
  signer: Signer;
  cookie: string;
}

export interface RouteHarness {
  deps: ServerDeps;
  db: PgliteDb;
  oneClick: OneClickStub;
  /** A signer whose key *is* registered as an access key of its own account. */
  newSigner(): Signer;
  /** A signer the account does not own — every use of it must be rejected. */
  foreignSigner(): Signer;
  /** Runs the real sign-in flow and returns a `Cookie:` header value for subsequent requests. */
  cookieFor(signer: Signer): Promise<string>;
  /** Sign a seller in through the real flow, then seed a destination + invoice for them. */
  seededInvoice(options?: { status?: "draft" | "open"; destinationAddress?: string }): Promise<SeededInvoice>;
  advance(ms: number): void;
  close(): Promise<void>;
}

let signerSequence = 0;

function makeSigner(accountId: string): Signer {
  signerSequence += 1;
  // Any 32 bytes are a valid ed25519 private key; deriving them from a counter keeps keys distinct
  // and the suite reproducible, without a random seed that would make a failure impossible to replay.
  const secret = new Uint8Array(32).map((_, index) => (signerSequence * 7 + index * 13) % 256);
  return { accountId, publicKey: `ed25519:${bs58.encode(ed25519.getPublicKey(secret))}`, secret };
}

let nonceSequence = 0;

/** A 32-byte base64 nonce, never reused within a process. */
export function freshNonce(): string {
  nonceSequence += 1;
  return Buffer.from(new Uint8Array(32).map((_, index) => (nonceSequence * 31 + index) % 256)).toString(
    "base64",
  );
}

export interface SignOptions {
  message?: string;
  recipient?: string;
  nonce?: string;
}

/** Only the fields the caller set, so an explicit `undefined` can never widen a required string. */
function optionals(options: SignOptions): { recipient?: string; nonce?: string } {
  return {
    ...(options.recipient === undefined ? {} : { recipient: options.recipient }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  };
}

/**
 * Sign a message the way a wallet does: Borsh payload, `sha256` over those exact bytes, base64
 * signature. The output is what `verifyNep413SignedMessage` rebuilds and checks.
 */
export function signClaims(
  signer: Signer,
  options: SignOptions & { message: string },
): SignedMessageFields {
  const recipient = options.recipient ?? APP_RECIPIENT;
  const nonce = options.nonce ?? freshNonce();
  const payload = serializeNep413Payload({
    message: options.message,
    nonce: new Uint8Array(Buffer.from(nonce, "base64")),
    recipient,
  });

  return {
    message: options.message,
    recipient,
    nonce,
    signature: Buffer.from(ed25519.sign(sha256(payload), signer.secret)).toString("base64"),
    publicKey: signer.publicKey,
  };
}

export function signInBody(signer: Signer, options: SignOptions = {}) {
  return {
    ...signClaims(signer, { message: options.message ?? "Settle sign-in", ...optionals(options) }),
    accountId: signer.accountId,
  };
}

export function payoutBody(
  signer: Signer,
  fields: { assetId: string; chain: string; address: string },
  options: SignOptions = {},
) {
  return {
    ...signClaims(
      signer,
      { message: options.message ?? payoutMessage(fields.chain, fields.address), ...optionals(options) },
    ),
    ...fields,
    addressConfirm: fields.address,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * One deposit address per real quote, ever.
 *
 * `payment_attempts.deposit_address` is unique, so `reset()` clears the script but not the counter:
 * a test reads the address off its own response instead of assuming which number it got.
 */
function depositAddressFor(sequence: number): string {
  return `settle-deposit-${String(sequence).padStart(4, "0")}`;
}

/** Echo the request into a quote envelope so a test can assert what Settle actually asked for. */
function quoteEnvelope(request: Record<string, unknown>, sequence: number): Record<string, unknown> {
  const dry = request.dry === true;
  const amountOut = String(request.amount);
  // 1 % slippage on the deposit side, mirroring `DEFAULT_SLIPPAGE_BPS`.
  const amountIn = ((BigInt(amountOut) * 101n) / 100n).toString();
  const quote: Record<string, unknown> = {
    amountIn,
    amountInFormatted: amountIn,
    amountInUsd: "1.01",
    minAmountIn: amountIn,
    amountOut,
    amountOutFormatted: amountOut,
    amountOutUsd: "1.00",
    minAmountOut: amountOut,
    timeEstimate: 45,
    deadline: request.deadline,
  };
  if (!dry) {
    quote.depositAddress = depositAddressFor(sequence);
    quote.depositMemo = `memo-${sequence}`;
  }

  return {
    correlationId: `st-route-quote-${sequence}`,
    timestamp: "2026-11-05T09:00:00Z",
    signature: "ed25519 UNSIGNED FIXTURE",
    quoteRequest: request,
    quote,
  };
}

/** Same envelope, signed by the throwaway manager key the harness pins in the env. */
function signedQuoteResponse(request: Record<string, unknown>, sequence: number): Response {
  return jsonResponse(signFixture(quoteEnvelope(request, sequence)));
}

export function createOneClickStub(): OneClickStub {
  const calls: StubCall[] = [];
  let statusQueue: (unknown | null)[] = [];
  let tokensBody: unknown = tokensFixture;
  let quoteHandler: ((body: unknown) => Response) | null = null;
  const failures = new Map<string, Response[]>();
  let sequence = 0;

  async function fetchImpl(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({
      path: url.pathname,
      body,
      query: Object.fromEntries(url.searchParams.entries()),
    });

    const queued = failures.get(url.pathname);
    const injected = queued?.shift();
    if (injected) return injected;

    if (url.pathname === "/v0/tokens") return jsonResponse(tokensBody);

    if (url.pathname === "/v0/quote") {
      if (quoteHandler) return quoteHandler(body);
      sequence += 1;
      return signedQuoteResponse((body ?? {}) as Record<string, unknown>, sequence);
    }

    if (url.pathname === "/v0/status") {
      const next = statusQueue.length > 1 ? statusQueue.shift() : statusQueue[0];
      if (next === null || next === undefined) {
        return jsonResponse({ message: "not found" }, 404);
      }
      return jsonResponse(next);
    }

    if (url.pathname === "/v0/deposit/submit") {
      return jsonResponse({
        correlationId: "st-route-submit",
        status: "KNOWN_DEPOSIT_TX",
        updatedAt: "2026-11-05T09:01:00Z",
      });
    }

    return jsonResponse({ message: `unstubbed 1Click path ${url.pathname}` }, 500);
  }

  return {
    fetch: fetchImpl,
    calls,
    statuses(...bodies) {
      statusQueue = bodies;
    },
    tokens(body) {
      tokensBody = body;
    },
    quote(handler) {
      quoteHandler = handler;
    },
    tamperedQuote() {
      quoteHandler = (body) => {
        sequence += 1;
        const signed = signFixture(quoteEnvelope((body ?? {}) as Record<string, unknown>, sequence));
        return jsonResponse(tamperAmountOut(signed, "1"));
      };
    },
    failOnce(path, status, body) {
      const queue = failures.get(path) ?? [];
      queue.push(jsonResponse(body ?? { message: `stubbed ${status} on ${path}` }, status));
      failures.set(path, queue);
    },
    quoteRequests() {
      return calls.filter((call) => call.path === "/v0/quote").map((call) => call.body);
    },
    reset() {
      calls.length = 0;
      statusQueue = [];
      tokensBody = tokensFixture;
      quoteHandler = null;
      failures.clear();
    },
  };
}

/**
 * Open the harness: install deps so `route.ts` handlers use this database and this stub, and forget
 * them again in `close()`.
 */
export async function createRouteHarness(): Promise<RouteHarness> {
  const connected: ConnectedDatabase<PgliteDb> = await openTestDatabase();
  const oneClick = createOneClickStub();

  const registered = new Map<string, string[]>();
  let clockMs = TEST_NOW_MS;

  const deps = createServerDeps({
    db: connected.db,
    env: TEST_ENV,
    oneClickFetch: oneClick.fetch,
    now: () => clockMs,
    accessKeys: async (accountId) => registered.get(accountId) ?? [],
  });
  installServerDeps(deps);

  const harness: RouteHarness = {
    deps,
    db: connected.db,
    oneClick,

    newSigner() {
      const signer = makeSigner(nextAccountId("seller"));
      registered.set(signer.accountId, [signer.publicKey]);
      return signer;
    },

    foreignSigner() {
      const signer = makeSigner(nextAccountId("stranger"));
      // The account exists and the signature is genuinely the signer's, but the RPC says the account
      // owns a *different* key — the exact forgery `accessKeys` is there to catch.
      registered.set(signer.accountId, [makeSigner(nextAccountId("owner")).publicKey]);
      return signer;
    },

    async cookieFor(signer) {
      const signedIn = await signIn(deps, signInBody(signer));
      // The `Set-Cookie` value up to the first attribute is exactly a `Cookie:` pair.
      return (signedIn.cookie.split(";")[0] ?? "").trim();
    },

    async seededInvoice(options = {}) {
      const signer = harness.newSigner();
      const cookie = await harness.cookieFor(signer);
      const user = await findUserByNearAccount(connected.db, signer.accountId);
      if (!user) throw new Error("seededInvoice: sign-in did not create a user");

      if (options.destinationAddress) {
        await setActiveDestination(connected.db, {
          userId: user.id,
          assetId: USDC_ON_NEAR,
          chain: "near",
          address: options.destinationAddress,
        });
      }

      const invoice = await createInvoice(connected.db, {
        userId: user.id,
        clientName: "Client Co",
        lines: [
          { description: "Design, sprint 12", quantity: "1", unitPrice: "5000000" },
          { description: "Rush surcharge", quantity: "1", unitPrice: "3" },
        ],
        status: options.status ?? "open",
      });

      return {
        userId: user.id,
        publicId: invoice.publicId,
        invoiceId: invoice.id,
        total: invoice.total,
        signer,
        cookie,
      };
    },

    advance(ms) {
      clockMs += ms;
    },

    async close() {
      clearServerDeps();
      await connected.close();
    },
  };

  return harness;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  cookie?: string | null;
  ip?: string;
}

/** Build the `Request` a route handler receives, exactly as Next would hand it over. */
export function apiRequest(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers({ "x-forwarded-for": options.ip ?? CLIENT_IP });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);

  return new Request(`${APP_ORIGIN}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null) throw new Error("response body is not an object");
  return parsed as Record<string, unknown>;
}

/** For the routes that answer with a bare array (`GET /api/invoices`, `GET /api/tokens`). */
export async function arrayOf(response: Response): Promise<Record<string, unknown>[]> {
  const parsed: unknown = await response.json();
  if (!Array.isArray(parsed)) throw new Error(`response body is not an array: ${JSON.stringify(parsed)}`);
  return parsed as Record<string, unknown>[];
}

/** The single error shape every route answers with (`lib/server/http.ts`). */
export async function errorOf(response: Response): Promise<Record<string, unknown>> {
  const body = await jsonOf(response);
  const error = body.error;
  if (typeof error !== "object" || error === null) throw new Error("response has no `error` object");
  return error as Record<string, unknown>;
}

/** The `details.issues` list a validation 400 carries; paths are dotted, as `issueList` writes them. */
export function issuesOf(error: Record<string, unknown>): { path: string; message: string }[] {
  const details = error.details;
  if (typeof details !== "object" || details === null) return [];
  const issues = (details as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as { path: string; message: string }[]) : [];
}
