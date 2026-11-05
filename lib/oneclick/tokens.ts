/**
 * `/v0/tokens` with a 10-minute in-memory cache.
 * Roadmap: S2.1 · Spec: ARCHITECTURE.md §3.2
 *
 * Asset ids and decimals are never hardcoded: every amount conversion takes its decimals from
 * this list, so a token that changes on the API side is picked up on the next refresh.
 * The response is zod-validated because the API can add fields or return a truncated list.
 *
 * The cache is a factory, not a module singleton: `lib/oneclick` cannot read the environment
 * (project_structure.md §1), so `lib/server/adapters.ts` owns one instance per process.
 * `ttlMs`/`now` are injectable so tests never wait ten minutes.
 */

import { z } from "zod";

import type { Asset, AssetId } from "../core/types";
import { isSupportedChain, type SupportedChain } from "../core/address";
import type { OneClickClient } from "./client";

export const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;

const tokenSchema = z
  .object({
    assetId: z.string().min(1),
    decimals: z.number().int().min(0),
    /** Left as a string: the API adds chains over time and the SDK enum must not gate us. */
    blockchain: z.string().min(1),
    symbol: z.string().min(1),
    price: z.number().nonnegative(),
    contractAddress: z.string().optional(),
  })
  .passthrough();

export const tokensResponseSchema = z.array(tokenSchema).min(1, "1Click returned no tokens");

export type OneClickToken = z.infer<typeof tokenSchema>;

/**
 * 1Click names chains in its own short codes (`eth`, `arb`, `sol`) while Settle and the address
 * validators use long names (`ethereum`, `arbitrum`, `solana`). This is the only place that
 * translates; anything stored keeps the Settle name.
 */
const CHAIN_CODE_TO_NAME: Readonly<Record<string, string>> = {
  near: "near",
  eth: "ethereum",
  base: "base",
  arb: "arbitrum",
  sol: "solana",
};

export function chainFromCode(code: string): SupportedChain | null {
  const name = CHAIN_CODE_TO_NAME[code.toLowerCase()];
  return name !== undefined && isSupportedChain(name) ? name : null;
}

export function codeForChain(chain: SupportedChain): string {
  for (const [code, name] of Object.entries(CHAIN_CODE_TO_NAME)) {
    if (name === chain) return code;
  }
  return chain;
}

export interface TokenRegistry {
  /** All supported tokens; refreshes when the cache is older than the TTL. */
  assets(): Promise<readonly Asset[]>;
  /** Exact lookup by 1Click asset id, or `null` when the API does not list it. */
  find(assetId: AssetId): Promise<Asset | null>;
  /** Tokens usable as a payout for Settle's supported chains, keyed by `chain:symbol`. */
  payoutAssets(): Promise<readonly Asset[]>;
  /** Force the next call to re-fetch, e.g. after a quote rejects an asset id. */
  invalidate(): void;
}

export interface TokenRegistryOptions {
  client: OneClickClient;
  ttlMs?: number;
  /** Injectable clock so cache tests are instant and deterministic. */
  now?: () => number;
}

function toAsset(token: OneClickToken): Asset {
  return {
    assetId: token.assetId,
    symbol: token.symbol,
    blockchain: token.blockchain,
    decimals: token.decimals,
  };
}

export function createTokenRegistry(options: TokenRegistryOptions): TokenRegistry {
  const ttlMs = options.ttlMs ?? TOKEN_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  let cache: { at: number; assets: readonly Asset[] } | null = null;
  /** Concurrent callers must share one HTTP round-trip, not stampede `/v0/tokens`. */
  let inflight: Promise<readonly Asset[]> | null = null;

  async function load(): Promise<readonly Asset[]> {
    const list = await options.client.requestJson(tokensResponseSchema, {
      method: "GET",
      path: "/v0/tokens",
    });
    const assets = list.map(toAsset);
    cache = { at: now(), assets };
    return assets;
  }

  async function assets(): Promise<readonly Asset[]> {
    if (cache && now() - cache.at < ttlMs) return cache.assets;
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    assets,
    async find(assetId) {
      const list = await assets();
      return list.find((asset) => asset.assetId === assetId) ?? null;
    },
    async payoutAssets() {
      const list = await assets();
      return list.filter((asset) => chainFromCode(asset.blockchain) !== null);
    },
    invalidate() {
      cache = null;
    },
  };
}
