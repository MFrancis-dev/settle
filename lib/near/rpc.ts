/**
 * NEAR JSON-RPC reads: account access keys and USDC storage balance.
 * Roadmap: S2.6 · Spec: ARCHITECTURE.md §3.2, §5
 *
 * Read-only by design — signing and sending live in `storage.ts` and never happen without an
 * explicit human go-ahead (AGENTS.md §7). The RPC URL is a required argument, not a baked-in
 * default, so nothing here can silently point demo mode at a funded network.
 *
 * Views are called through `query`/`call_function` with base64 args, and a view's `result` is
 * itself base64 of a JSON string — the double decode is the RPC shape, not a mistake.
 */

import { z } from "zod";

import type { BaseUnits } from "../core/types";
import { parseBaseUnits } from "../core/money";

/** A real `fetch`, or a fake in tests: tests must never reach a public RPC (AGENTS.md §8). */
export type RpcFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface NearRpcConfig {
  url: string;
  fetchImpl?: RpcFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** `storage_balance_of` / `storage_balance_bounds` answers are yoctoNEAR decimal strings. */
const storageBalanceSchema = z
  .object({ total: z.string().regex(/^\d+$/), available: z.string().regex(/^\d+$/) })
  .passthrough();

export interface StorageBalance {
  /** yoctoNEAR held to keep the account registered for the token, as base units. */
  total: BaseUnits;
  /** Usable part of `total` — the rest may be reserved by other contracts. */
  available: BaseUnits;
}

const errorSchema = z.object({ message: z.string().optional(), code: z.number().optional() });

const rpcEnvelopeSchema = z
  .object({
    error: errorSchema.optional(),
    result: z.unknown().optional(),
  })
  .passthrough();

const callFunctionResultSchema = z
  .object({
    /** base64 of the JSON the view method returned. */
    result: z.string(),
    block_height: z.number().optional(),
  })
  .passthrough();

const viewAccountSchema = z
  .object({
    account_id: z.string(),
    amount: z.string().optional(),
    access_keys: z.array(
      z
        .object({
          public_key: z.string().startsWith("ed25519:"),
          access_key: z.object({ nonce: z.number().int(), permission: z.unknown() }).passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const viewAccessKeyListSchema = z
  .object({
    keys: z.array(
      z
        .object({
          public_key: z.string().startsWith("ed25519:"),
          access_key: z.object({ nonce: z.union([z.string(), z.number()]) }).passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function encodeArgs(args: unknown): string {
  return Buffer.from(JSON.stringify(args), "utf8").toString("base64");
}

/**
 * `storage_balance_of` for one account on one fungible-token contract.
 * Returns `null` when the account is not registered, which is exactly the case a payout
 * destination needs a `storage_deposit` for (an unregistered receiver loses an `ft_transfer`).
 */
export async function storageBalanceOf(
  config: NearRpcConfig,
  contractId: string,
  accountId: string,
): Promise<StorageBalance | null> {
  const raw = await callView(config, contractId, "storage_balance_of", { account_id: accountId });
  if (raw === null || raw === "null") return null;
  const parsed = storageBalanceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NearRpcError(
      "unexpected_result",
      `${contractId}.storage_balance_of returned an unreadable body for ${accountId}`,
    );
  }
  return {
    total: parseBaseUnits(parsed.data.total),
    available: parseBaseUnits(parsed.data.available),
  };
}

/** The contract's own registration cost, so the amount to deposit is read rather than guessed. */
export async function storageBalanceBounds(
  config: NearRpcConfig,
  contractId: string,
): Promise<{ min: BaseUnits; max: BaseUnits }> {
  const raw = await callView(config, contractId, "storage_balance_bounds", {});
  const parsed = z
    .object({ min: z.string().regex(/^\d+$/), max: z.string().regex(/^\d+$/) })
    .safeParse(raw);
  if (!parsed.success) {
    throw new NearRpcError("unexpected_result", `${contractId}.storage_balance_bounds unreadable`);
  }
  return { min: parseBaseUnits(parsed.data.min), max: parseBaseUnits(parsed.data.max) };
}

/** Full access keys + function-key nonces for an account; used to check a NEP-413 signature. */
export async function getAccessKeys(
  config: NearRpcConfig,
  accountId: string,
): Promise<readonly { publicKey: string; nonce: number }[]> {
  const body = await rpcRequest(config, "query", {
    request_type: "view_access_key_list",
    account_id: accountId,
    finality: "optimistic",
  });
  const parsed = viewAccessKeyListSchema.safeParse(body);
  if (!parsed.success) {
    throw new NearRpcError("unexpected_result", `access keys for ${accountId} unreadable`);
  }
  return parsed.data.keys.map((key) => ({
    publicKey: key.public_key,
    nonce: Number(key.access_key.nonce),
  }));
}

/** Account record, including whether the account exists at all. */
export async function viewAccount(
  config: NearRpcConfig,
  accountId: string,
): Promise<z.infer<typeof viewAccountSchema>> {
  const body = await rpcRequest(config, "query", {
    request_type: "view_account",
    account_id: accountId,
    finality: "optimistic",
  });
  const parsed = viewAccountSchema.safeParse(body);
  if (!parsed.success) {
    throw new NearRpcError("unexpected_result", `account ${accountId} unreadable`);
  }
  return parsed.data;
}

export class NearRpcError extends Error {
  constructor(
    readonly kind: "not_configured" | "http" | "rpc_error" | "unexpected_result" | "timeout",
    detail: string,
  ) {
    super(`NEAR RPC ${kind}: ${detail}`);
    this.name = "NearRpcError";
  }
}

async function rpcRequest(
  config: NearRpcConfig,
  method: string,
  params: unknown,
): Promise<unknown> {
  if (!config.url) {
    throw new NearRpcError("not_configured", "NEAR_RPC_URL is not set; real-mode reads cannot run");
  }
  const doFetch = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  if (config.signal) {
    if (config.signal.aborted) controller.abort();
    else config.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await doFetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "settle", method, params }),
      signal: controller.signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    throw new NearRpcError(
      controller.signal.aborted ? "timeout" : "http",
      `${method} failed (${cause instanceof Error ? cause.name : "unknown"})`,
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new NearRpcError("http", `${method} returned HTTP ${response.status}`);
  }

  // Read as text first: an RPC endpoint behind a proxy answers HTML with a 200, and `response.json()`
  // would then throw a raw SyntaxError instead of the NearRpcError every caller branches on.
  const text = await response.text();
  let json: unknown;
  try {
    json = text.length === 0 ? undefined : (JSON.parse(text) as unknown);
  } catch {
    throw new NearRpcError("unexpected_result", `${method} replied with a body that is not JSON`);
  }

  const envelope = rpcEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new NearRpcError("unexpected_result", `${method} returned an unreadable envelope`);
  }
  if (envelope.data.error) {
    throw new NearRpcError(
      "rpc_error",
      `${method}: ${envelope.data.error.message ?? "no message"} (code ${envelope.data.error.code ?? "?"})`,
    );
  }
  return envelope.data.result;
}

async function callView(
  config: NearRpcConfig,
  contractId: string,
  methodName: string,
  args: unknown,
): Promise<unknown> {
  const result = await rpcRequest(config, "query", {
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: encodeArgs(args),
    finality: "optimistic",
  });
  const parsed = callFunctionResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new NearRpcError("unexpected_result", `${contractId}.${methodName} envelope unreadable`);
  }
  const json = Buffer.from(parsed.data.result, "base64").toString("utf8");
  if (json === "null") return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new NearRpcError("unexpected_result", `${contractId}.${methodName} is not JSON`);
  }
}
