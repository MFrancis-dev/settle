/**
 * HTTP plumbing that keeps route handlers thin: body parsing, the error envelope, client IP.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1, §6, §9
 *
 * Every failure leaves through `errorResponse`, so a route never re-maps a `OneClickError` and an
 * internal message can only reach a client through the table below. Unknown errors answer 500 with
 * a fixed sentence: the stack stays in the server log (AGENTS.md §6 — no leak through an error body).
 *
 * No `server-only` marker: route tests and `tsx` scripts import this, and that package throws under
 * plain Node (see `lib/server/db.ts`). Client components must never import it.
 */

import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";

import { NearRpcError } from "../near/rpc";
import { QuoteSignatureError } from "../oneclick/quote";
import { OneClickError } from "../oneclick/client";
import { SessionRejection } from "./session";

/** Stable, machine-readable; the UI branches on these, never on the message text. */
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "same_asset"
  | "rate_limited"
  | "amount_too_low"
  | "upstream_rejected"
  | "upstream_unreachable"
  | "server_misconfigured"
  | "internal_error";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

/** A failure a handler raises deliberately, carrying the status the client should see. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);
export const unauthorized = (message: string, details?: unknown) =>
  new HttpError(401, "unauthorized", message, details);
export const forbidden = (message: string, details?: unknown) =>
  new HttpError(403, "forbidden", message, details);
export const notFound = (message: string, details?: unknown) =>
  new HttpError(404, "not_found", message, details);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "conflict", message, details);
export const rateLimited = (retryAfterS: number) =>
  new HttpError(429, "rate_limited", "Too many requests, slow down.", { retryAfterS });

export interface JsonOptions {
  status?: number;
  headers?: Record<string, string>;
  /** Money and status responses are never cacheable: a stale quote is a wrong quote. */
  noStore?: boolean;
}

export function json<T>(data: T, options: JsonOptions = {}): NextResponse<T> {
  const headers = { ...(options.headers ?? {}) };
  if (options.noStore !== false) headers["Cache-Control"] ??= "no-store";
  return NextResponse.json(data, { status: options.status ?? 200, headers });
}

/** Validation issues flattened to `{path, message}` — the order the form fields appear in. */
export function issueList(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** Parse a JSON request body through a schema; a non-JSON body is a 400, never a 500. */
export async function parseJsonBody<T>(
  request: { text: () => Promise<string> },
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const text = await request.text();
  if (text.trim() === "") throw badRequest("A JSON body is required");

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw badRequest("Request body is not valid JSON");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw badRequest("Invalid request body", { issues: issueList(parsed.error) });
  return parsed.data;
}

/** Query-string values through a schema (`URLSearchParams` is a plain record by then). */
export function parseQuery<T>(
  searchParams: URLSearchParams,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  const plain: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) plain[key] = value;
  const parsed = schema.safeParse(plain);
  if (!parsed.success) {
    throw badRequest("Invalid query string", { issues: issueList(parsed.error) });
  }
  return parsed.data;
}

/**
 * The caller's address for rate limiting. Behind a reverse proxy `x-forwarded-for` is a chain
 * and the *first* hop is the client; a deployment with no proxy header degrades to one shared
 * bucket rather than throwing, because the limit is a spam control, not an authorisation check.
 */
export function clientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown-client";
}

function mapOneClick(error: OneClickError): HttpError {
  switch (error.kind) {
    case "amount_too_low":
      return new HttpError(400, "amount_too_low", "1Click rejected this amount as too small.", {
        minimumBaseUnits: error.minimum?.baseUnits ?? null,
        minimumUsd: error.minimum?.usd ?? null,
      });
    case "invalid_request":
      // `detail` is the upstream's own wording about the request we sent. It is safe to *answer*
      // with and unsafe to *log* — `OneClickError.message` is the log-safe half (S7.10).
      return new HttpError(400, "upstream_rejected", "1Click rejected the request.", {
        detail: error.detail,
      });
    case "not_found":
      return new HttpError(404, "not_found", "1Click has no record of this deposit.");
    case "rate_limited":
      return new HttpError(429, "rate_limited", "1Click is rate limiting us. Try again shortly.");
    case "unauthorized":
      // Our partner JWT is wrong, not the caller's credentials: never a 401 for the client.
      return new HttpError(500, "server_misconfigured", "The 1Click credentials were refused.");
    case "malformed_response":
      return new HttpError(502, "upstream_rejected", "1Click returned something unexpected.");
    case "unreachable":
    case "server_error":
      return new HttpError(502, "upstream_unreachable", "1Click is not reachable right now.");
  }
}

/** Translate any thrown value into the one error shape the API answers with. */
export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  const mapped =
    error instanceof HttpError
      ? error
      : error instanceof ZodError
        ? badRequest("Invalid request body", { issues: issueList(error) })
        : error instanceof SessionRejection
          ? unauthorized(`No valid session (${error.reason}).`)
          : error instanceof QuoteSignatureError
            ? // A quote whose signature does not check out is never shown, and the client cannot fix it.
              new HttpError(502, "upstream_rejected", "That quote could not be verified.")
            : error instanceof OneClickError
              ? mapOneClick(error)
              : error instanceof NearRpcError
                ? error.kind === "not_configured"
                  ? new HttpError(
                      500,
                      "server_misconfigured",
                      "NEAR_RPC_URL is not set, so signed actions cannot be verified.",
                    )
                  : new HttpError(502, "upstream_unreachable", "The NEAR RPC is not reachable.")
                : new HttpError(500, "internal_error", "Something went wrong.");

  const body: ApiErrorBody = {
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details === undefined ? {} : { details: mapped.details }),
    },
  };
  const response = NextResponse.json(body, { status: mapped.status });
  if (mapped.status === 429) {
    const retryAfter = (mapped.details as { retryAfterS?: number } | undefined)?.retryAfterS;
    response.headers.set("Retry-After", String(retryAfter ?? 30));
  }
  return response;
}

/**
 * Run a handler and answer its result, or the error it threw, in one shape.
 * `Response` is the declared return so a route can add headers (a `Set-Cookie`) without casting.
 */
export async function route(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}
