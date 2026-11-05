import { describe, expect, it, vi } from "vitest";

import { createOneClickClient, type FetchLike } from "./client";
import { chainFromCode, codeForChain, createTokenRegistry, TOKEN_CACHE_TTL_MS } from "./tokens";
import tokensFixture from "./__fixtures__/tokens.json";

function registry(fetchImpl: FetchLike, cache?: { now?: () => number; ttlMs?: number }) {
  return createTokenRegistry({ client: createOneClickClient({ fetchImpl }), ...cache });
}

function responding(status: number, body: unknown): FetchLike {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

const fixtureFetch = () => responding(200, tokensFixture);

describe("oneclick/tokens", () => {
  it("reads decimals and asset ids from the API, not from constants", async () => {
    const near = await registry(fixtureFetch()).find("nep141:wrap.near");
    expect(near).toEqual({
      assetId: "nep141:wrap.near",
      symbol: "wNEAR",
      blockchain: "near",
      decimals: 24,
    });
  });

  it("answers an unknown asset id with null rather than guessing", async () => {
    expect(await registry(fixtureFetch()).find("nep141:nonexistent")).toBeNull();
  });

  it("serves the cache for ten minutes and refetches after", async () => {
    let clock = 1_000;
    const fetchImpl = fixtureFetch();
    const cache = registry(fetchImpl, { now: () => clock });

    await cache.assets();
    await cache.assets();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += TOKEN_CACHE_TTL_MS - 1;
    await cache.assets();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 1;
    await cache.assets();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent lookups into one request", async () => {
    const fetchImpl = fixtureFetch();
    const cache = registry(fetchImpl);
    const [all, payout, near] = await Promise.all([
      cache.assets(),
      cache.payoutAssets(),
      cache.find("nep141:wrap.near"),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(all.length).toBe(tokensFixture.length);
    expect(near?.symbol).toBe("wNEAR");
    expect(payout.length).toBeLessThan(all.length);
  });

  it("refetches after invalidate(), which is what a rejected asset id needs", async () => {
    const fetchImpl = fixtureFetch();
    const cache = registry(fetchImpl);
    await cache.assets();
    cache.invalidate();
    await cache.assets();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("filters payout assets to chains Settle can validate an address for", async () => {
    const payout = await registry(fixtureFetch()).payoutAssets();
    const chains = payout.map((asset) => asset.blockchain);
    expect(chains).toEqual(["near", "near", "base", "arb", "eth", "eth", "sol"]);
    expect(chains).not.toContain("btc");
    expect(chains).not.toContain("ton");
    expect(chains).not.toContain("stellar");
  });

  it("rejects an empty token list instead of caching it", async () => {
    const error = await registry(responding(200, []))
      .assets()
      .catch((cause: unknown) => cause);
    expect((error as Error).message).toMatch(/1Click returned no tokens/);
  });

  it("translates 1Click chain codes both ways", () => {
    expect(chainFromCode("eth")).toBe("ethereum");
    expect(chainFromCode("ARB")).toBe("arbitrum");
    expect(chainFromCode("sol")).toBe("solana");
    expect(chainFromCode("base")).toBe("base");
    expect(chainFromCode("near")).toBe("near");
    expect(chainFromCode("btc")).toBeNull();
    expect(chainFromCode("")).toBeNull();
    expect(codeForChain("ethereum")).toBe("eth");
    expect(codeForChain("arbitrum")).toBe("arb");
    expect(codeForChain("near")).toBe("near");
  });
});
