/**
 * The API client's own contract: paths, verbs, and what it does with each reply.
 * Roadmap: S4.1–S4.7
 *
 * A scripted `fetch` records the requests and replays canned bodies — the same fixture pattern the
 * 1Click client is tested with. Settle's own routes are not mocked here; they are the thing on the
 * other side of this boundary, and they have their own route tests.
 */

import { describe, it, expect } from "vitest";

import { ApiError, createApi, type FetchLike } from "./client";
import type { ApiErrorBody } from "./types";

interface Call {
  path: string;
  method: string;
  body: unknown;
}

function scripted(reply: { status?: number; body?: unknown | string }) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({
      path: input,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    const status = reply.status ?? 200;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? null);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { api: createApi(fetchImpl), calls };
}

describe("createApi — requests", () => {
  it("addresses every endpoint the way the routes are mounted", async () => {
    const { api, calls } = scripted({ body: [] });
    await api.invoices({ status: "open", limit: 25 });
    await api.createInvoice({ clientName: "Berlin Studio", items: [] });
    await api.invoice("11111111-1111-4111-8111-111111111111");
    await api.cancelInvoice("11111111-1111-4111-8111-111111111111");
    await api.quote("abc123", {
      originAsset: "nep141:wrap.near",
      refundTo: "ada.test-account",
      dry: true,
    });
    await api.submitTx("abc123", "7".repeat(44));
    await api.receipt("attempt-id", "tok");
    await api.setPayout({
      message: "m",
      recipient: "r",
      nonce: "n",
      signature: "s",
      publicKey: "ed25519:x",
      assetId: "a",
      chain: "near",
      address: "ada.test-account",
      addressConfirm: "ada.test-account",
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/invoices?status=open&limit=25",
      "POST /api/invoices",
      "GET /api/invoices/11111111-1111-4111-8111-111111111111",
      "POST /api/invoices/11111111-1111-4111-8111-111111111111/cancel",
      "POST /api/pay/abc123/quote",
      "POST /api/pay/abc123/submit-tx",
      "GET /api/receipts/attempt-id?token=tok",
      "PUT /api/payout",
    ]);
    // A path segment is escaped, so an id from a URL cannot reach another route.
    expect(calls[1]?.body).toEqual({ clientName: "Berlin Studio", items: [] });
    expect(calls[5]?.body).toEqual({ txHash: "7".repeat(44) });
  });

  it("escapes a hostile public id instead of letting it join the path", async () => {
    const { api, calls } = scripted({ body: {} });
    await api.publicInvoice("../session");
    expect(calls[0]?.path).toBe("/api/pay/..%2Fsession");
  });

  it("signs in with the wallet's body and nothing else", async () => {
    const { api, calls } = scripted({
      status: 201,
      body: { nearAccountId: "a", displayName: "a", isNew: true },
    });
    const body = {
      message: "Settle sign-in for settle.test",
      recipient: "settle.test",
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      signature: "sig",
      publicKey: "ed25519:key",
      accountId: "a.test-account",
    };
    await expect(api.signIn(body)).resolves.toEqual({
      nearAccountId: "a",
      displayName: "a",
      isNew: true,
    });
    expect(calls[0]).toEqual({ path: "/api/session", method: "POST", body });
  });
});

describe("createApi — replies", () => {
  it("passes the body through on success", async () => {
    const { api } = scripted({ body: { nearAccountId: "ada.test-account", isDemo: false } });
    await expect(api.me()).resolves.toMatchObject({ nearAccountId: "ada.test-account" });
  });

  it("turns the error envelope into a plain-language ApiError", async () => {
    const envelope: ApiErrorBody = {
      error: { code: "conflict", message: "A payment address is already open for this invoice." },
    };
    const { api } = scripted({ status: 409, body: envelope });
    const error = await api
      .quote("x", { originAsset: "a", refundTo: "b", dry: false })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(error.message).toBe("A payment address is already open for this invoice.");
  });

  it("exposes rejected fields so a form can mark them", async () => {
    const { api } = scripted({
      status: 400,
      body: {
        error: {
          code: "bad_request",
          message: "Check the highlighted fields.",
          details: {
            issues: [
              { path: "items.0.quantity", message: "Quantity has at most 4 decimal places" },
              { path: "clientName", message: "Required" },
            ],
          },
        },
      },
    });
    const error = await api.createInvoice({ clientName: "", items: [] }).catch((e) => e);
    expect((error as ApiError).issues).toHaveLength(2);
    expect((error as ApiError).issues[0]?.path).toBe("items.0.quantity");
  });

  it("reads the retry window out of a 429", async () => {
    const { api } = scripted({
      status: 429,
      body: {
        error: { code: "rate_limited", message: "Too many quotes.", details: { retryAfterS: 37 } },
      },
    });
    const error = (await api
      .quote("x", { originAsset: "a", refundTo: "b", dry: true })
      .catch((e) => e)) as ApiError;
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfterS).toBe(37);
  });

  it("keeps a signature rejection reason", async () => {
    const { api } = scripted({
      status: 401,
      body: {
        error: {
          code: "unauthorized",
          message: "No valid session.",
          details: { reason: "signature_mismatch" },
        },
      },
    });
    const error = (await api.me().catch((e) => e)) as ApiError;
    expect(error.signatureReason).toBe("signature_mismatch");
  });

  it("survives a non-JSON error page", async () => {
    const { api } = scripted({ status: 500, body: "<html>gateway error</html>" });
    const error = (await api.me().catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.message).toBe("Something went wrong. Please try again.");
  });

  it("reports an unreadable success body instead of returning undefined", async () => {
    const { api } = scripted({ status: 200, body: "not json" });
    await expect(api.me()).rejects.toThrow("something we could not read");
  });
});
