/**
 * S2.6 — NEAR JSON-RPC reads against recorded envelopes.
 * Spec: ARCHITECTURE.md §5 · tests never reach a public RPC (AGENTS.md §8)
 *
 * The double-encoding is what these tests exist to pin: `query`/`call_function` answers carry a
 * base64 string of the JSON the view method returned, so a wrong decode silently reads as
 * "no storage balance" — which is a payout that never arrives.
 */

import { describe, expect, it } from "vitest";

import {
  NearRpcError,
  getAccessKeys,
  storageBalanceBounds,
  storageBalanceOf,
  viewAccount,
  type NearRpcConfig,
  type RpcFetch,
} from "./rpc";

const RPC_URL = "https://rpc.testnet.near.org";
const CONTRACT = "btc-USDC.near";

function json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/** A `call_function` envelope: the view's JSON, base64'd, as the RPC sends it. */
function viewEnvelope(result: unknown) {
  return { jsonrpc: "2.0", id: "settle", result: { result: json(result), block_height: 128_000 } };
}

function rpc(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: RpcFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  const config: NearRpcConfig = { url: RPC_URL, fetchImpl };
  return { calls, config };
}

/** The params the RPC must be sent with, with `args_base64` decoded back to an object. */
function request(body: RequestInit | undefined) {
  const parsed = JSON.parse(String(body?.body)) as {
    jsonrpc: string;
    id: string;
    method: string;
    params: Record<string, string>;
  };
  const encoded = parsed.params.args_base64;
  return {
    ...parsed,
    // Only `call_function` carries args; the other request types would decode to a syntax error.
    args:
      encoded === undefined
        ? undefined
        : (JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown),
  };
}

describe("storageBalanceOf", () => {
  it("decodes a registered account's storage balance into base units", async () => {
    const { calls, config } = rpc(viewEnvelope({ total: "18731921234", available: "731921234" }));
    const balance = await storageBalanceOf(config, CONTRACT, "freelancer.testnet");

    expect(balance).toEqual({ total: "18731921234", available: "731921234" });
    expect(calls[0]?.url).toBe(RPC_URL);
    expect(request(calls[0]?.init)).toMatchObject({
      jsonrpc: "2.0",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: CONTRACT,
        method_name: "storage_balance_of",
        finality: "optimistic",
      },
    });
    expect(request(calls[0]?.init).args).toEqual({ account_id: "freelancer.testnet" });
  });

  it("reads an unregistered account as null, not as zero", async () => {
    // `null` is the answer that triggers a storage_deposit; "0" would mean a funded, unusable slot.
    const { config } = rpc(viewEnvelope(null));
    expect(await storageBalanceOf(config, CONTRACT, "someone.testnet")).toBeNull();
  });

  it("rejects a balance body it cannot read rather than guessing", async () => {
    const { config } = rpc(viewEnvelope({ total: "not-a-number" }));
    await expect(storageBalanceOf(config, CONTRACT, "someone.testnet")).rejects.toThrow(
      /unreadable body/,
    );
  });
});

describe("storageBalanceBounds", () => {
  it("reads the contract's own registration cost", async () => {
    const { calls, config } = rpc(viewEnvelope({ min: "18731921234", max: "37463842468" }));
    expect(await storageBalanceBounds(config, CONTRACT)).toEqual({
      min: "18731921234",
      max: "37463842468",
    });
    expect(request(calls[0]?.init).args).toEqual({});
  });

  it("throws rather than depositing a made-up amount", async () => {
    const { config } = rpc(viewEnvelope({ min: 18731921234 }));
    await expect(storageBalanceBounds(config, CONTRACT)).rejects.toBeInstanceOf(NearRpcError);
  });
});

describe("getAccessKeys", () => {
  it("normalises the nonce to a number and keeps the full key list", async () => {
    const { calls, config } = rpc({
      jsonrpc: "2.0",
      id: "settle",
      result: {
        block_height: 999,
        keys: [
          {
            public_key: "ed25519:Gcu3DgAXACy6UZ22H2s3mUdFmYHe15J3fYHh4Bpx1nn3",
            access_key: { nonce: "42", permission: { FullAccess: {} } },
          },
          {
            public_key: "ed25519:E8aYa9A2tWrDMnRhLiXGQJd6mznF1J9J9jkXuBqCVZyD",
            access_key: {
              nonce: 7,
              permission: { FunctionCall: { receiver_id: "settle.testnet" } },
            },
          },
        ],
      },
    });

    expect(await getAccessKeys(config, "freelancer.testnet")).toEqual([
      { publicKey: "ed25519:Gcu3DgAXACy6UZ22H2s3mUdFmYHe15J3fYHh4Bpx1nn3", nonce: 42 },
      { publicKey: "ed25519:E8aYa9A2tWrDMnRhLiXGQJd6mznF1J9J9jkXuBqCVZyD", nonce: 7 },
    ]);
    expect(request(calls[0]?.init)).toMatchObject({
      method: "query",
      params: { request_type: "view_access_key_list", account_id: "freelancer.testnet" },
    });
  });

  it("rejects a key list that is not the shape the RPC documents", async () => {
    const { config } = rpc({
      jsonrpc: "2.0",
      id: "settle",
      result: { keys: [{ public_key: "secp256k1:aa" }] },
    });
    await expect(getAccessKeys(config, "someone.testnet")).rejects.toThrow(/unreadable/);
  });
});

describe("viewAccount", () => {
  it("returns the account record for the existence check", async () => {
    const { config } = rpc({
      jsonrpc: "2.0",
      id: "settle",
      result: {
        account_id: "client.testnet",
        amount: "1000000000000000000000000",
        locked: "0",
        code_hash: "11111111111111111111111111111111",
        storage_usage: 341,
        storage_paid_at: 0,
        block_height: 128_000,
        access_keys: [
          {
            public_key: "ed25519:Gcu3DgAXACy6UZ22H2s3mUdFmYHe15J3fYHh4Bpx1nn3",
            access_key: { nonce: 1, permission: { FullAccess: {} } },
          },
        ],
      },
    });
    const account = await viewAccount(config, "client.testnet");
    expect(account.account_id).toBe("client.testnet");
    expect(account.amount).toBe("1000000000000000000000000");
    expect(account.access_keys).toHaveLength(1);
  });
});

describe("failure modes", () => {
  it("keeps the RPC message and code, because a missing account is a real answer", async () => {
    const { config } = rpc({
      jsonrpc: "2.0",
      id: "settle",
      error: { code: -32003, message: "account doesn't exist" },
    });
    const error = await viewAccount(config, "gone.testnet").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NearRpcError);
    expect((error as NearRpcError).kind).toBe("rpc_error");
    expect((error as NearRpcError).message).toContain("account doesn't exist");
    expect((error as NearRpcError).message).toContain("-32003");
  });

  it("reports an HTTP failure as http, not as an empty result", async () => {
    const { config } = rpc({ message: "upstream rejected" }, 502);
    const error = await storageBalanceBounds(config, CONTRACT).catch((cause: unknown) => cause);
    expect((error as NearRpcError).kind).toBe("http");
    expect((error as NearRpcError).message).toContain("502");
  });

  it("refuses to run without an RPC url instead of defaulting to a funded network", async () => {
    const config: NearRpcConfig = { url: "", fetchImpl: rpc({}).config.fetchImpl };
    await expect(viewAccount(config, "anyone.testnet")).rejects.toThrow(/not_configured/);
  });

  it("turns a transport failure into http", async () => {
    const fetchImpl: RpcFetch = () => Promise.reject(new TypeError("fetch failed"));
    const config: NearRpcConfig = { url: RPC_URL, fetchImpl };
    const error = await viewAccount(config, "anyone.testnet").catch((cause: unknown) => cause);
    expect((error as NearRpcError).kind).toBe("http");
  });

  it("aborts a view that never answers", async () => {
    const fetchImpl: RpcFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    const config: NearRpcConfig = { url: RPC_URL, fetchImpl, timeoutMs: 5 };
    const error = await viewAccount(config, "anyone.testnet").catch((cause: unknown) => cause);
    expect((error as NearRpcError).kind).toBe("timeout");
  });

  it("rejects an envelope that is not JSON at all, rather than leaking a parse error", async () => {
    const fetchImpl: RpcFetch = () => Promise.resolve(new Response("<html>login required</html>"));
    const config: NearRpcConfig = { url: RPC_URL, fetchImpl };
    const error = await viewAccount(config, "anyone.testnet").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NearRpcError);
    expect((error as NearRpcError).kind).toBe("unexpected_result");
  });
});
