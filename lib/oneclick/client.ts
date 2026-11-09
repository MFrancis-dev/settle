/**
 * 1Click HTTP client: base URL, optional partner JWT, typed errors.
 * Roadmap: S2.1 · Spec: ARCHITECTURE.md §3.2
 *
 * We call the API with our own `fetch` instead of the SDK's service classes: the SDK drives
 * axios with no injection point (so tests could not run offline, AGENTS.md §8) and returns
 * unvalidated JSON (AGENTS.md §6 requires zod at that boundary). The SDK is still used for
 * what only it can do — the API types and `verifyQuoteSignature()`.
 *
 * Paths, query keys and bodies were copied from the installed SDK 0.1.26 (`OneClickService`),
 * which is generated from https://1click.chaindefuser.com/docs/v0/openapi.yaml.
 *
 * This module receives its config as arguments: `lib/oneclick` sits below `lib/server`
 * (project_structure.md §1) and must not import it.
 *
 * No `server-only` marker, for the reason recorded in `lib/server/db.ts`: the worker and the tsx
 * scripts build this client, and that package throws under plain Node. Client components must
 * never import it — the JWT reaches it only from `lib/server/adapters.ts`.
 */

import { z } from "zod";

export const ONECLICK_DEFAULT_BASE_URL = "https://1click.chaindefuser.com";

/** A real `fetch`, or a fake that returns `new Response(...)` in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OneClickClientConfig {
  baseUrl?: string;
  /** Partner JWT from partners.near-intents.org. Without it 1Click adds a fee; never log it. */
  jwt?: string;
  fetchImpl?: FetchLike;
  /** Set by both; a caller-supplied value is concatenated. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type OneClickErrorKind =
  | "amount_too_low"
  | "unauthorized"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "unreachable"
  | "server_error"
  | "malformed_response";

/**
 * One error type for every failure, so callers never branch on HTTP codes.
 * `minimum` is only set for `amount_too_low`: 1Click does not publish a minimums table, it rejects
 * at quote time with the smallest accepted amount in the message (ARCHITECTURE.md §11), so we parse
 * it rather than hardcode it. It is an object rather than two optional trailing arguments because
 * both halves are strings and a caller passing them the wrong way round would still typecheck.
 *
 * **`message` is deliberately log-safe and `detail` is not** (S7.10). Every log site in this repo
 * prints `error.message` — the worker's `describeFailure`, `lib/server/auth.ts`, the scripts — so
 * whatever is in `message` ends up in a log. `detail` holds up to 300 characters of the upstream
 * response body, which can carry a deposit address, an account id or the partner's own wording
 * about our credentials; it is for a client-facing error response (`lib/server/http.ts`), never for
 * a log line. Keeping the two apart here means no log site has to remember to redact.
 */
export class OneClickError extends Error {
  readonly kind: OneClickErrorKind;
  readonly status: number | null;
  /** Upstream error text, sliced. Read this only to answer a client; never log it. */
  readonly detail: string;

  constructor(
    kind: OneClickErrorKind,
    status: number | null,
    detail: string,
    readonly minimum?: QuoteMinimum,
  ) {
    super(`1Click ${kind} (${status ?? "no response"})`);
    this.name = "OneClickError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * The floor behind an `amount_too_low`. `baseUnits` counts the **payout** asset — measured
 * 2026-11-09, a BTC → USDC route refused 5 USDC with `try at least 6232326` and accepted 6232327,
 * while costing 0.00008799 BTC. `usd` is the other shape the vendor uses: a dollar figure with no
 * base units in it, so no asset amount can be derived without a price Settle does not have.
 */
export interface QuoteMinimum {
  readonly baseUnits?: string;
  readonly usd?: string;
}

/** `Amount is too low for bridge, try at least 300001` → "300001". */
export function parseTooLowMinimum(message: string): string | undefined {
  return /try at least (\d+)/.exec(message)?.[1];
}

/**
 * Both refusal shapes, in one parse. `Temporary swap limits: minimum swap amount is $100` →
 * `{ usd: "100" }`. A grouped figure like `$1,000` deliberately does not match: the trailing guard
 * makes the parser refuse to guess, and the screen falls back to a sentence with no number.
 */
export function parseQuoteMinimum(message: string): QuoteMinimum | undefined {
  const baseUnits = parseTooLowMinimum(message);
  const usd = /\$([0-9]+(?:\.[0-9]{1,2})?)(?![0-9.,])/.exec(message)?.[1];
  return baseUnits === undefined && usd === undefined ? undefined : { baseUnits, usd };
}

const errorBodySchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .passthrough();

function errorText(body: unknown): string {
  if (typeof body === "string") return body;
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) return "unparsable error body";
  return parsed.data.message ?? parsed.data.error ?? "no message";
}

function kindFor(status: number, body: unknown): OneClickErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 400) {
    return parseQuoteMinimum(errorText(body)) ? "amount_too_low" : "invalid_request";
  }
  return status >= 500 ? "server_error" : "invalid_request";
}

export interface RequestJsonOptions {
  method: "GET" | "POST";
  /** Path only, e.g. "/v0/quote". Query values are URL-encoded by this function. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface OneClickClient {
  readonly baseUrl: string;
  readonly hasJwt: boolean;
  /**
   * `Input` is pinned to `unknown` on purpose: `z.ZodType<T>` defaults it to `T` as well, which
   * makes TypeScript infer `T` from the schema's *input* type — so a `.default()` field would
   * come back `| undefined` even though parsing always fills it.
   */
  requestJson<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: RequestJsonOptions,
  ): Promise<T>;
}

/**
 * POST/GET a 1Click endpoint and validate the JSON before anything downstream sees it.
 * A non-2xx or unparsable body always rejects with `OneClickError`; transport failures
 * become `unreachable` so callers never have to handle a raw TypeError.
 */
export function createOneClickClient(config: OneClickClientConfig = {}): OneClickClient {
  const baseUrl = (config.baseUrl ?? ONECLICK_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  async function requestJson<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: RequestJsonOptions,
  ): Promise<T> {
    const url = new URL(baseUrl + options.path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.jwt) headers.Authorization = `Bearer ${config.jwt}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (config.signal) {
      if (config.signal.aborted) controller.abort();
      else config.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new OneClickError(
        "unreachable",
        null,
        `could not reach ${url.pathname} (${cause instanceof Error ? cause.name : "unknown"})`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsedJson: unknown = undefined;
    if (text.length > 0) {
      try {
        parsedJson = JSON.parse(text) as unknown;
      } catch {
        parsedJson = text;
      }
    }

    if (!response.ok) {
      const status = response.status;
      const detail = errorText(parsedJson);
      throw new OneClickError(
        kindFor(status, parsedJson),
        status,
        detail.slice(0, 300),
        status === 400 ? parseQuoteMinimum(detail) : undefined,
      );
    }

    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new OneClickError(
        "malformed_response",
        response.status,
        `unexpected ${options.method} ${options.path} body: ${validated.error.issues
          .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
          .join(", ")
          .slice(0, 300)}`,
      );
    }
    return validated.data;
  }

  return {
    baseUrl,
    hasJwt: config.jwt !== undefined,
    requestJson,
  };
}
