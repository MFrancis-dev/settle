import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  createOneClickClient,
  OneClickError,
  parseQuoteMinimum,
  parseTooLowMinimum,
  type FetchLike,
} from "./client";

const okSchema = z.object({ ok: z.boolean() }).passthrough();

interface Captured {
  url: string;
  init?: RequestInit;
}

function clientReturning(status: number, body: unknown, captured?: Captured) {
  const fetchImpl: FetchLike = (url, init) => {
    if (captured) {
      captured.url = url;
      captured.init = init;
    }
    return Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );
  };
  return createOneClickClient({ fetchImpl });
}

describe("oneclick/client", () => {
  it("uses the documented base URL when none is configured", () => {
    expect(createOneClickClient().baseUrl).toBe("https://1click.chaindefuser.com");
  });

  it("strips a trailing slash so paths never double up", async () => {
    const captured: Captured = { url: "" };
    const client = createOneClickClient({
      baseUrl: "https://1click.example.com/",
      fetchImpl: (url, init) => {
        captured.url = url;
        captured.init = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      },
    });
    expect(client.baseUrl).toBe("https://1click.example.com");
    await client.requestJson(okSchema, { method: "GET", path: "/v0/tokens" });
    expect(captured.url).toBe("https://1click.example.com/v0/tokens");
  });

  it("sends the partner JWT only when one was given", async () => {
    const withJwt: Captured = { url: "" };
    const authed = createOneClickClient({
      jwt: "a.b.c",
      fetchImpl: (url, init) => {
        withJwt.url = url;
        withJwt.init = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      },
    });
    await authed.requestJson(okSchema, { method: "GET", path: "/v0/tokens" });
    const headers = withJwt.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer a.b.c");
    expect(authed.hasJwt).toBe(true);

    const anon: Captured = { url: "" };
    await clientReturning(200, { ok: true }, anon).requestJson(okSchema, {
      method: "GET",
      path: "/v0/tokens",
    });
    expect((anon.init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("encodes query parameters and skips undefined ones", async () => {
    const captured: Captured = { url: "" };
    await clientReturning(200, { ok: true }, captured).requestJson(okSchema, {
      method: "GET",
      path: "/v0/status",
      query: { depositAddress: "addr/with space", depositMemo: undefined },
    });
    const url = new URL(captured.url);
    expect(url.pathname).toBe("/v0/status");
    expect(url.searchParams.get("depositAddress")).toBe("addr/with space");
    expect(url.searchParams.has("depositMemo")).toBe(false);
  });

  it("parses the minimum 1Click quotes back out of its error message", () => {
    expect(parseTooLowMinimum("Amount is too low for bridge, try at least 300001")).toBe("300001");
    expect(parseTooLowMinimum("try at least 0")).toBe("0");
    expect(parseTooLowMinimum("Amount is too low")).toBeUndefined();
  });

  // Both texts here are verbatim from live 400s on 2026-11-09 (#135).
  it("reads the floor from both refusal shapes 1Click uses", () => {
    expect(parseQuoteMinimum("Amount is too low for bridge, try at least 6232326")).toStrictEqual({
      baseUnits: "6232326",
      usd: undefined,
    });
    expect(parseQuoteMinimum("Temporary swap limits: minimum swap amount is $100")).toStrictEqual({
      baseUnits: undefined,
      usd: "100",
    });
    expect(parseQuoteMinimum("Temporary swap limits: minimum swap amount is $99.50")?.usd).toBe(
      "99.50",
    );
  });

  it("refuses to guess a floor it cannot read, rather than printing a wrong number", () => {
    // A thousands separator is the one case a naive `\$([0-9]+)` would turn into $1.
    expect(parseQuoteMinimum("minimum swap amount is $1,000")?.usd).toBeUndefined();
    expect(parseQuoteMinimum("minimum swap amount is $100000000")).toStrictEqual({
      baseUnits: undefined,
      usd: "100000000",
    });
    expect(parseQuoteMinimum("Unknown asset")).toBeUndefined();
    expect(parseQuoteMinimum("try at least ")?.baseUnits).toBeUndefined();
  });

  it.each([
    [401, "unauthorized", { message: "Invalid JWT" }],
    [404, "not_found", { message: "Deposit address not found" }],
    [429, "rate_limited", { message: "Too many requests" }],
    [500, "server_error", "upstream exploded"],
  ] as const)("maps HTTP %i to %s", async (status, kind, body) => {
    const client = clientReturning(status, body);
    const error = await client
      .requestJson(okSchema, { method: "GET", path: "/v0/quote" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OneClickError);
    expect((error as OneClickError).kind).toBe(kind);
    expect((error as OneClickError).status).toBe(status);
  });

  it("turns a too-low 400 into amount_too_low with the minimum attached", async () => {
    const client = clientReturning(400, {
      message: "Amount is too low for bridge, try at least 300001",
    });
    const error = await client
      .requestJson(okSchema, { method: "POST", path: "/v0/quote", body: {} })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OneClickError);
    expect((error as OneClickError).kind).toBe("amount_too_low");
    expect((error as OneClickError).minimum?.baseUnits).toBe("300001");
  });

  it("treats a dollar-denominated swap limit as the same failure, with a dollar floor", async () => {
    const error = await clientReturning(400, {
      message: "Temporary swap limits: minimum swap amount is $100",
    })
      .requestJson(okSchema, { method: "POST", path: "/v0/quote", body: {} })
      .catch((cause: unknown) => cause);
    expect((error as OneClickError).kind).toBe("amount_too_low");
    // No base units exist in that message, and none are invented from the dollars (#135).
    expect((error as OneClickError).minimum).toStrictEqual({
      baseUnits: undefined,
      usd: "100",
    });
  });

  it("keeps any other 400 as invalid_request", async () => {
    const error = await clientReturning(400, { message: "Unknown asset" })
      .requestJson(okSchema, { method: "POST", path: "/v0/quote", body: {} })
      .catch((cause: unknown) => cause);
    expect((error as OneClickError).kind).toBe("invalid_request");
    expect((error as OneClickError).minimum).toBeUndefined();
  });

  it("rejects a 200 body that does not match the schema instead of trusting it", async () => {
    const error = await clientReturning(200, { notOk: "yes" })
      .requestJson(okSchema, { method: "GET", path: "/v0/tokens" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OneClickError);
    expect((error as OneClickError).kind).toBe("malformed_response");
    // The validation report is on `detail`; `message` stays log-safe (S7.10).
    expect((error as OneClickError).detail).toContain("ok: Required");
    expect((error as OneClickError).message).toBe("1Click malformed_response (200)");
  });

  it("reports a transport failure as unreachable, never as a raw TypeError", async () => {
    const client = createOneClickClient({
      fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
    });
    const error = await client
      .requestJson(okSchema, { method: "GET", path: "/v0/tokens" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OneClickError);
    expect((error as OneClickError).kind).toBe("unreachable");
    expect((error as OneClickError).status).toBeNull();
  });

  it("aborts on its own timeout", async () => {
    const client = createOneClickClient({
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    });
    const error = await client
      .requestJson(okSchema, { method: "GET", path: "/v0/quote" })
      .catch((cause: unknown) => cause);
    expect((error as OneClickError).kind).toBe("unreachable");
  });
});
