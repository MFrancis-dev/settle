import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Roadmap: S3.4, S3.8 · the asset list is the only place an asset id and a decimal count are decided.
import { GET } from "./route";
import { TOKEN_CACHE_TTL_MS } from "@/lib/oneclick/tokens";
import {
  USDC_ON_NEAR,
  createRouteHarness,
  errorOf,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

beforeAll(async () => {
  harness = await createRouteHarness();
});

beforeEach(async () => {
  harness.oneClick.reset();
  // every test gets its own round-trip, so the cached list never hides a bug in a later one
  harness.advance(TOKEN_CACHE_TTL_MS);
});

afterAll(async () => {
  await harness?.close();
});

async function tokens(): Promise<Record<string, unknown>> {
  return await jsonOf(await GET());
}

function options(body: Record<string, unknown>, key: "assets" | "payoutAssets") {
  return body[key] as Record<string, unknown>[];
}

describe("GET /api/tokens", () => {
  it("names every 1Click asset with the chain Settle validates it on", async () => {
    const body = await tokens();
    const assets = options(body, "assets");

    expect(assets).toHaveLength(10);
    expect(assets.find((asset) => asset.assetId === USDC_ON_NEAR)).toEqual({
      assetId: USDC_ON_NEAR,
      symbol: "USDC",
      blockchain: "near",
      decimals: 6,
      refundSupported: true,
      settleChain: "near",
    });
    // 1Click's short codes are translated once, here, so no client has to learn them
    expect(assets.find((asset) => asset.blockchain === "eth")).toMatchObject({
      settleChain: "ethereum",
    });
    expect(assets.find((asset) => asset.blockchain === "sol")).toMatchObject({
      settleChain: "solana",
    });
  });

  it("keeps assets we cannot check a refund address for, but marks them unofferable", async () => {
    const assets = options(await tokens(), "assets");
    const uncheckable = assets
      .filter((asset) => asset.refundSupported === false)
      .map((asset) => asset.blockchain);

    expect(uncheckable.sort()).toEqual(["btc", "stellar", "ton"]);
    for (const asset of assets.filter((entry) => entry.refundSupported === false)) {
      expect(asset.settleChain).toBeNull();
    }
  });

  it("offers only chains it can validate as a payout", async () => {
    const payout = options(await tokens(), "payoutAssets");

    expect(payout).toHaveLength(7);
    expect(payout.map((asset) => asset.blockchain).sort()).toEqual(
      ["base", "near", "near", "arb", "eth", "eth", "sol"].sort(),
    );
    expect(payout.every((asset) => asset.refundSupported === true)).toBe(true);
  });

  it("serves the list from the 10-minute cache", async () => {
    const before = harness.oneClick.calls.filter((call) => call.path === "/v0/tokens").length;

    const first = await tokens();
    const second = await tokens();

    expect(second).toEqual(first);
    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/tokens")).toHaveLength(
      before + 1,
    );
  });

  it("re-fetches once the cache is older than the TTL", async () => {
    await tokens();
    harness.advance(TOKEN_CACHE_TTL_MS);
    await tokens();

    expect(harness.oneClick.calls.filter((call) => call.path === "/v0/tokens")).toHaveLength(2);
  });

  it("answers 502 instead of an empty list when 1Click is down", async () => {
    harness.oneClick.failOnce("/v0/tokens", 500);

    const response = await GET();
    const error = await errorOf(response);

    expect(response.status).toBe(502);
    expect(error.code).toBe("upstream_unreachable");
  });

  it("refuses a truncated list, and does not remember it", async () => {
    harness.oneClick.tokens([]);
    const rejected = await GET();
    expect(rejected.status).toBe(502);
    expect((await errorOf(rejected)).code).toBe("upstream_rejected");

    // a bad list must not be remembered: the next read asks again and the page works
    harness.oneClick.reset();
    const recovered = await tokens();
    expect(options(recovered, "assets")).toHaveLength(10);
  });
});
