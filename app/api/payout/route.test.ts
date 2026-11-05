import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Roadmap: S3.2, S3.8 · the one route that can lose money: a session alone must never move the payout address.
import { GET, PUT } from "./route";
import {
  USDC_ON_NEAR,
  apiRequest,
  createRouteHarness,
  errorOf,
  issuesOf,
  jsonOf,
  payoutBody,
  signClaims,
  type RouteHarness,
  type Signer,
} from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

beforeAll(async () => {
  harness = await createRouteHarness();
});

afterAll(async () => {
  await harness?.close();
});

function put(cookie: string, body: unknown): Promise<Response> {
  return PUT(apiRequest("/api/payout", { method: "PUT", body, cookie }));
}

/** A destination-change body, signed by `signer` over the message the route expects. */
function change(signer: Signer, address: string, chain = "near", assetId = USDC_ON_NEAR) {
  return payoutBody(signer, { assetId, chain, address });
}

describe("PUT /api/payout", () => {
  it("requires a session before anything else", async () => {
    const { signer } = await harness.seededInvoice();

    expect((await put("settle_session=forged.value", change(signer, "anyone.testnet"))).status).toBe(401);
    expect((await PUT(apiRequest("/api/payout", { method: "PUT", body: {} }))).status).toBe(401);
  });

  it("changes the destination when the wallet signed the new address", async () => {
    const { signer, cookie } = await harness.seededInvoice();
    const response = await put(cookie, change(signer, "new-payout.testnet"));
    const body = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ changed: true });
    expect(body.payout).toMatchObject({ chain: "near", address: "new-payout.testnet", active: true });
  });

  it("reports a USDC storage read it could not run instead of guessing", async () => {
    const { signer, cookie } = await harness.seededInvoice();

    // AGENTS.md §7: registering for storage spends real funds, so an unreadable contract stays
    // "we do not know". A false `registered: false` would let the UI promise a payout will land.
    const body = await jsonOf(await put(cookie, change(signer, "another.testnet")));

    expect(body.storage).toMatchObject({ checked: false, registered: null, reason: "unconfigured" });
  });

  it("skips the storage check for an asset it does not apply to", async () => {
    const { signer, cookie } = await harness.seededInvoice();

    // Only USDC on NEAR needs a storage bond, so a wNEAR destination must not show a bond warning.
    const body = await jsonOf(await put(cookie, change(signer, "wrapped.testnet", "near", "nep141:wrap.near")));

    expect(body.storage).toBeNull();
    expect(body.payout).toMatchObject({ assetId: "nep141:wrap.near", assetSymbol: "wNEAR", address: "wrapped.testnet" });
  });

  it("says nothing changed when the same address is submitted twice", async () => {
    const { signer, cookie } = await harness.seededInvoice();

    expect((await put(cookie, change(signer, "same.testnet"))).status).toBe(200);
    const again = await put(cookie, change(signer, "same.testnet"));

    expect(again.status).toBe(200);
    expect(await jsonOf(again)).toMatchObject({ changed: false });
  });

  it("refuses when the two address fields disagree", async () => {
    const { signer, cookie } = await harness.seededInvoice();
    const body = { ...change(signer, "one.testnet"), addressConfirm: "two.testnet" };

    const response = await put(cookie, body);

    expect(response.status).toBe(400);
    expect(issuesOf(await errorOf(response))).toContainEqual({ path: "addressConfirm", message: "The two addresses must match" });
  });

  it("refuses an address that is not valid for the chain", async () => {
    const { signer, cookie } = await harness.seededInvoice();

    const response = await put(cookie, change(signer, "not a valid account id!!"));
    const error = await errorOf(response);

    expect(response.status).toBe(400);
    expect(error.code).toBe("bad_request");
    expect(issuesOf(error)[0]?.path).toBe("address");
  });

  it("refuses a signature from a key the account does not own", async () => {
    const { cookie } = await harness.seededInvoice();
    const response = await put(cookie, change(harness.foreignSigner(), "hijack.testnet"));

    expect(response.status).toBe(401);
    expect((await errorOf(response)).details).toEqual({
      reason: "signature_mismatch",
      expectedMessage: "Settle payout change to hijack.testnet on near",
    });
  });

  it("refuses a signature made over a different message and says what to sign", async () => {
    const { signer, cookie } = await harness.seededInvoice();
    const body = {
      ...signClaims(signer, { message: "Settle sign-in" }),
      assetId: USDC_ON_NEAR,
      chain: "near",
      address: "attacker.testnet",
      addressConfirm: "attacker.testnet",
    };

    const response = await put(cookie, body);
    const details = (await errorOf(response)).details as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(details.reason).toBe("message_mismatch");
    expect(details.expectedMessage).toBe("Settle payout change to attacker.testnet on near");
  });

  it("refuses a captured payout change replayed a second time", async () => {
    const { signer, cookie } = await harness.seededInvoice();
    const body = change(signer, "once.testnet");

    expect((await put(cookie, body)).status).toBe(200);
    const second = await put(cookie, body);

    expect(second.status).toBe(401);
    expect((await errorOf(second)).details).toMatchObject({ reason: "replayed" });
  });

  it("leaves the destination untouched when the fresh signature fails", async () => {
    const { cookie } = await harness.seededInvoice({ destinationAddress: "keep-me.testnet" });
    const before = await jsonOf(await GET(apiRequest("/api/payout", { cookie })));
    const body = {
      ...signClaims(harness.foreignSigner(), { message: "Settle payout change to never.testnet on near" }),
      assetId: USDC_ON_NEAR,
      chain: "near",
      address: "never.testnet",
      addressConfirm: "never.testnet",
    };

    expect((await put(cookie, body)).status).toBe(401);
    expect(await jsonOf(await GET(apiRequest("/api/payout", { cookie })))).toEqual(before);
  });
});

describe("GET /api/payout", () => {
  it("requires a session", async () => {
    expect((await GET(apiRequest("/api/payout"))).status).toBe(401);
    expect((await GET(apiRequest("/api/payout", { cookie: "settle_session=YWJj.ZGVm" }))).status).toBe(401);
  });

  it("returns the whole change log with exactly one active row", async () => {
    const { signer, cookie } = await harness.seededInvoice({ destinationAddress: "first.testnet" });
    await put(cookie, change(signer, "second.testnet"));

    const payouts = await list(cookie);

    // Sign-in leaves the account's own address as the first destination, then every change adds a row.
    expect(payouts.map((row) => row.address).sort()).toEqual(
      [signer.accountId, "first.testnet", "second.testnet"].sort(),
    );
    expect(payouts.filter((row) => row.active)).toEqual([
      expect.objectContaining({ address: "second.testnet" }),
    ]);
  });

  it("shows one account's history to nobody else", async () => {
    const mine = await harness.seededInvoice({ destinationAddress: "mine.testnet" });
    const other = await harness.seededInvoice({ destinationAddress: "theirs.testnet" });

    const mineAddresses = (await list(mine.cookie)).map((row) => row.address);
    const otherAddresses = (await list(other.cookie)).map((row) => row.address);

    expect(mineAddresses).toContain("mine.testnet");
    expect(otherAddresses).toContain("theirs.testnet");
    expect(mineAddresses).not.toContain("theirs.testnet");
    expect(otherAddresses).not.toContain("mine.testnet");
  });
});

async function list(cookie: string): Promise<Record<string, unknown>[]> {
  const body = await jsonOf(await GET(apiRequest("/api/payout", { cookie })));
  return body.payouts as Record<string, unknown>[];
}
