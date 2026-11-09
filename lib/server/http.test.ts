import { describe, expect, it } from "vitest";
import { z } from "zod";

// Roadmap: S3.8
import { NearRpcError } from "../near/rpc";
import { OneClickError } from "../oneclick/client";
import { QuoteSignatureError } from "../oneclick/quote";
import { SessionRejection } from "./session";
import {
  HttpError,
  badRequest,
  clientIp,
  conflict,
  errorResponse,
  forbidden,
  issueList,
  json,
  notFound,
  parseJsonBody,
  parseQuery,
  rateLimited,
  route,
  unauthorized,
} from "./http";

const bodySchema = z.object({ name: z.string().min(3), count: z.coerce.number().int() });

function requestWith(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("json responses", () => {
  it("keeps money and status responses out of every cache", async () => {
    const response = json({ total: "5000003" });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await bodyOf(response)).toEqual({ total: "5000003" });
  });

  it("passes a status and extra headers through", () => {
    const response = json({ ok: true }, { status: 201, headers: { "Set-Cookie": "a=b" } });

    expect(response.status).toBe(201);
    expect(response.headers.get("Set-Cookie")).toBe("a=b");
  });
});

describe("body parsing", () => {
  const withText = (text: string) => ({ text: async () => text });

  it("returns schema-parsed data, including coercion", async () => {
    await expect(
      parseJsonBody(withText('{"name":"alice","count":"3"}'), bodySchema),
    ).resolves.toEqual({
      name: "alice",
      count: 3,
    });
  });

  it("calls an empty body a 400 rather than a JSON error", async () => {
    const error = await parseJsonBody(withText("   "), bodySchema).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
  });

  it("calls unparsable JSON a 400", async () => {
    const error = await parseJsonBody(withText("{name"), bodySchema).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as HttpError).message).toContain("not valid JSON");
  });

  it("lists every validation issue with its path", async () => {
    const error = (await parseJsonBody(withText('{"name":"a","count":"x"}'), bodySchema).catch(
      (thrown: unknown) => thrown,
    )) as HttpError;

    const issues = (error.details as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path)).toEqual(["name", "count"]);
    expect(errorResponse(error).status).toBe(400);
  });

  it("flattens a nested path the way a form field is named", () => {
    const error = z.object({ items: z.array(z.object({ qty: z.string().min(1) })) }).safeParse({
      items: [{ qty: "" }],
    }).error;

    expect(issueList(error as z.ZodError)[0]?.path).toBe("items.0.qty");
  });
});

describe("query parsing", () => {
  it("coerces and validates query values", () => {
    expect(parseQuery(new URLSearchParams("count=7&name=acme"), bodySchema)).toEqual({
      name: "acme",
      count: 7,
    });
  });

  it("rejects an unparsable query with a 400, not a 500", () => {
    expect(() => parseQuery(new URLSearchParams("count=nope&name=acme"), bodySchema)).toThrowError(
      HttpError,
    );

    try {
      parseQuery(new URLSearchParams("count=nope&name=acme"), bodySchema);
    } catch (error) {
      expect((error as HttpError).status).toBe(400);
    }
  });

  it("ignores parameters the schema does not mention", () => {
    const strict = z.object({ status: z.string() });
    expect(parseQuery(new URLSearchParams("status=paid&junk=1"), strict)).toEqual({
      status: "paid",
    });
  });
});

describe("client address", () => {
  it("takes the first hop of a proxy chain", () => {
    expect(
      clientIp(requestWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 198.51.100.2" })),
    ).toBe("203.0.113.7");
  });

  it("falls back to one shared bucket when no proxy header is present", () => {
    expect(clientIp(requestWith({}))).toBe("unknown-client");
    expect(clientIp(requestWith({ "x-forwarded-for": "   " }))).toBe("unknown-client");
  });
});

describe("error envelope", () => {
  const cases: readonly { name: string; thrown: unknown; status: number; code: string }[] = [
    { name: "HttpError", thrown: conflict("Nope"), status: 409, code: "conflict" },
    { name: "ZodError", thrown: bodySchema.safeParse({}).error, status: 400, code: "bad_request" },
    {
      name: "SessionRejection",
      thrown: new SessionRejection("expired"),
      status: 401,
      code: "unauthorized",
    },
    {
      name: "QuoteSignatureError",
      thrown: new QuoteSignatureError("corr-1", "bad"),
      status: 502,
      code: "upstream_rejected",
    },
    {
      name: "OneClick unreachable",
      thrown: new OneClickError("unreachable", null, "down"),
      status: 502,
      code: "upstream_unreachable",
    },
    {
      name: "OneClick 404",
      thrown: new OneClickError("not_found", 404, "gone"),
      status: 404,
      code: "not_found",
    },
    {
      name: "OneClick amount too low",
      thrown: new OneClickError("amount_too_low", 400, "min", { baseUnits: "300001" }),
      status: 400,
      code: "amount_too_low",
    },
    {
      name: "OneClick refused our JWT",
      thrown: new OneClickError("unauthorized", 401, "bad jwt"),
      status: 500,
      code: "server_misconfigured",
    },
    {
      name: "NearRpcError not configured",
      thrown: new NearRpcError("not_configured", "NEAR_RPC_URL"),
      status: 500,
      code: "server_misconfigured",
    },
    {
      name: "NearRpcError unreachable",
      thrown: new NearRpcError("timeout", "rpc"),
      status: 502,
      code: "upstream_unreachable",
    },
    {
      name: "anything else",
      thrown: new Error("internal detail"),
      status: 500,
      code: "internal_error",
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} answers ${testCase.status} ${testCase.code}`, async () => {
      const response = errorResponse(testCase.thrown);
      const body = await bodyOf(response);
      const error = body.error as Record<string, unknown>;

      expect(response.status).toBe(testCase.status);
      expect(error.code).toBe(testCase.code);
      expect(typeof error.message).toBe("string");
    });
  }

  // `lib/ui/quote-failure.ts` reads both keys, so this pair is the contract the pay screen is built
  // on: 1Click states its floor in payout base units or in dollars, and only one half is ever filled.
  it("carries whichever half of the minimum 1Click actually stated", async () => {
    const inBaseUnits = await bodyOf(
      errorResponse(new OneClickError("amount_too_low", 400, "min", { baseUnits: "6232326" })),
    );
    const inDollars = await bodyOf(
      errorResponse(new OneClickError("amount_too_low", 400, "min", { usd: "100" })),
    );

    expect((inBaseUnits.error as { details: unknown }).details).toMatchObject({
      minimumBaseUnits: "6232326",
      minimumUsd: null,
    });
    expect((inDollars.error as { details: unknown }).details).toMatchObject({
      minimumBaseUnits: null,
      minimumUsd: "100",
    });
  });

  it("never leaks an unexpected error's message", async () => {
    const body = await bodyOf(errorResponse(new Error("connection string leaked")));

    expect(JSON.stringify(body)).not.toContain("connection string");
  });

  it("answers a client with the upstream's wording while keeping it out of the log half (S7.10)", async () => {
    const thrown = new OneClickError(
      "invalid_request",
      400,
      "no route from nep141:wrap.near to client.near on 0xabc123",
    );

    // The response may carry it: it is the caller's own request being described.
    const body = await bodyOf(errorResponse(thrown));
    expect((body.error as { details: { detail: string } }).details.detail).toContain(
      "no route from",
    );

    // The log may not. Every log site in this repo prints `error.message` — the worker's
    // `describeFailure`, `lib/server/auth.ts`, the scripts — so `message` is the leak surface.
    expect(thrown.message).toBe("1Click invalid_request (400)");
    expect(thrown.message).not.toContain("0xabc123");
    expect(String(thrown)).not.toContain("0xabc123");
  });

  it("keeps details a handler attached", async () => {
    const body = await bodyOf(errorResponse(badRequest("No", { reason: "nonce_too_short" })));

    expect((body.error as { details: unknown }).details).toEqual({ reason: "nonce_too_short" });
  });

  it("sends Retry-After with a 429 and nothing else", async () => {
    expect(errorResponse(rateLimited(45)).headers.get("Retry-After")).toBe("45");
    expect(errorResponse(forbidden("no")).headers.get("Retry-After")).toBeNull();
    expect(errorResponse(new Error("x")).headers.get("Retry-After")).toBeNull();
  });

  it("answers an unauthorized helper with 401 and a reason", async () => {
    const response = errorResponse(
      unauthorized("Signature rejected (replayed).", { reason: "replayed" }),
    );

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toEqual({
      error: {
        code: "unauthorized",
        message: "Signature rejected (replayed).",
        details: { reason: "replayed" },
      },
    });
  });

  it("gives a missing resource one shape, so ids cannot be probed", async () => {
    expect(await bodyOf(errorResponse(notFound("No such invoice.")))).toEqual({
      error: { code: "not_found", message: "No such invoice." },
    });
  });
});

describe("route wrapper", () => {
  it("returns whatever the handler returns", async () => {
    await expect(route(async () => json({ ok: true }))).resolves.toBeInstanceOf(Response);
  });

  it("turns a thrown error into the error envelope", async () => {
    const response = await route(async () => {
      throw notFound("No such payment link.");
    });

    expect(response.status).toBe(404);
    expect(((await bodyOf(response)).error as { code: string }).code).toBe("not_found");
  });

  it("does not swallow a non-error throw", async () => {
    const response = await route(async () => {
      throw "a string";
    });

    expect(response.status).toBe(500);
  });
});
