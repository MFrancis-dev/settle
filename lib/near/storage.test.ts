/**
 * S2.8 — the read-only half of the storage-deposit decision, against a scripted RPC.
 * Spec: ARCHITECTURE.md §3.2, §11 · tests never reach a public RPC (AGENTS.md §8)
 *
 * Both directions of a wrong answer cost money, which is what these tests are for: a
 * "needs registration" that is not needed spends the payer account, and an "already
 * registered" that is not true sends an `ft_transfer` the token contract refuses — the
 * freelancer simply does not get paid.
 */

import { describe, expect, it } from "vitest";

import type { BaseUnits } from "../core/types";
import { parseBaseUnits } from "../core/money";
import { NearRpcError, type NearRpcConfig, type RpcFetch } from "./rpc";
import {
  buildStorageDepositAction,
  checkStorageRequirement,
  formatRegistrationCost,
  totalRegistrationCost,
  unregisteredAccounts,
  type StorageRequirement,
} from "./storage";

const CONTRACT = "usdc.ft.contract";
/** What the contract charges to register one account: 0.001258682 NEAR in yoctoNEAR. */
const MIN: BaseUnits = parseBaseUnits("1258682000000000000000");
/** Half of it, for the partially-registered case. */
const HALF = "629341000000000000000";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

interface Script {
  /** `null` is the answer an unregistered account gets; `"error"` is an account that does not exist. */
  balance?: { total: string; available: string } | null | "error";
  /** Fail the `storage_balance_of` call in a way that is *not* an RPC error. */
  balanceFailsWith?: "http";
}

/** A fetch that answers the two views `checkStorageRequirement` calls, and nothing else. */
function scripted(script: Script) {
  const seen: string[] = [];
  const fetchImpl: RpcFetch = (_url, init) => {
    const params = (JSON.parse(String(init?.body)) as { params: { method_name?: string } }).params;
    if (params.method_name === "storage_balance_bounds") {
      seen.push("bounds");
      return Promise.resolve(
        new Response(JSON.stringify({ result: { result: b64({ min: MIN, max: MIN }) } })),
      );
    }
    seen.push("balance_of");
    if (script.balance === "error") {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: -32003, message: "account doesn't exist" } })),
      );
    }
    if (script.balanceFailsWith === "http") {
      return Promise.resolve(new Response("bad gateway", { status: 502 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ result: { result: b64(script.balance ?? null) } })),
    );
  };
  const config: NearRpcConfig = { url: "https://rpc.testnet.near.org", fetchImpl };
  return { seen, config };
}

describe("checkStorageRequirement", () => {
  it("leaves a registered account alone", async () => {
    const { config } = scripted({ balance: { total: MIN, available: MIN } });
    const requirement = await checkStorageRequirement(config, CONTRACT, "freelancer.testnet");
    expect(requirement).toEqual({
      accountId: "freelancer.testnet",
      registered: true,
      balance: { total: MIN, available: MIN },
      minimum: MIN,
      topUp: "0",
    });
  });

  it("tops up past a balance that is above the minimum, not by the minimum again", async () => {
    const { config } = scripted({ balance: { total: "99999999999999999999999", available: MIN } });
    const requirement = await checkStorageRequirement(config, CONTRACT, "rich.testnet");
    expect(requirement.registered).toBe(true);
    expect(requirement.topUp).toBe("0");
  });

  it("asks for the whole minimum when the account has never registered", async () => {
    const { config } = scripted({ balance: null });
    const requirement = await checkStorageRequirement(config, CONTRACT, "newbie.testnet");
    expect(requirement).toMatchObject({ registered: false, balance: null, topUp: MIN });
  });

  it("asks only for the shortfall when the balance is half of what the contract wants", async () => {
    const { config } = scripted({ balance: { total: HALF, available: HALF } });
    const requirement = await checkStorageRequirement(config, CONTRACT, "partial.testnet");
    expect(requirement.registered).toBe(false);
    expect(BigInt(requirement.topUp)).toBe(BigInt(MIN) - BigInt(HALF));
  });

  it("treats an account that does not exist as unregistered, because it is still a valid payout address", async () => {
    const { config } = scripted({ balance: "error" });
    const requirement = await checkStorageRequirement(config, CONTRACT, "ghost.testnet");
    expect(requirement).toMatchObject({ registered: false, balance: null, topUp: MIN });
  });

  it("re-throws any other failure instead of guessing at the payer's cost", async () => {
    // A 502 is not evidence about the account; spending the payer account on a guess is worse.
    const { config } = scripted({ balanceFailsWith: "http" });
    const error = await checkStorageRequirement(config, CONTRACT, "anyone.testnet").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(NearRpcError);
    expect((error as NearRpcError).kind).toBe("http");
  });

  it("reads both views it needs and nothing else", async () => {
    const { seen, config } = scripted({ balance: null });
    await checkStorageRequirement(config, CONTRACT, "newbie.testnet");
    expect(seen).toEqual(["bounds", "balance_of"]);
  });
});

describe("cost maths", () => {
  const requirement = (
    accountId: string,
    registered: boolean,
    topUp: string,
  ): StorageRequirement => ({
    accountId,
    registered,
    balance: null,
    minimum: MIN,
    topUp: parseBaseUnits(topUp),
  });

  it("lists the payout accounts that would refuse a transfer", () => {
    const requirements = [
      requirement("a.testnet", true, "0"),
      requirement("b.testnet", false, MIN),
      requirement("c.testnet", false, MIN),
    ];
    expect(unregisteredAccounts(requirements)).toEqual(["b.testnet", "c.testnet"]);
  });

  it("adds the deposits up for one batch run of the payer", () => {
    const requirements = [
      requirement("a.testnet", true, "0"),
      requirement("b.testnet", false, MIN),
      requirement("c.testnet", false, HALF),
    ];
    expect(totalRegistrationCost(requirements)).toBe("1888023000000000000000");
    expect(totalRegistrationCost([])).toBe("0");
  });

  it("shows the cost in NEAR before asking for the human yes", () => {
    // 1 NEAR is 10^24 yoctoNEAR, which is the only reason this function exists.
    expect(formatRegistrationCost(parseBaseUnits("20000000000000000000000000"))).toBe("20 NEAR");
    expect(formatRegistrationCost(parseBaseUnits("20000000000000000000000"))).toBe("0.02 NEAR");
    expect(formatRegistrationCost(MIN)).toBe("0.001258682 NEAR");
    expect(formatRegistrationCost(parseBaseUnits("0"))).toBe("0 NEAR");
  });
});

describe("buildStorageDepositAction", () => {
  it("is the call S2.10 signs, with the account named in the args", () => {
    expect(buildStorageDepositAction("freelancer.testnet", MIN)).toEqual({
      methodName: "storage_deposit",
      args: { account_id: "freelancer.testnet" },
      attachedDeposit: MIN,
    });
  });

  it("refuses to build a transaction that attaches nothing", () => {
    // An empty attachment is a call that succeeds and registers nobody.
    expect(() => buildStorageDepositAction("freelancer.testnet", parseBaseUnits("0"))).toThrow(
      RangeError,
    );
  });
});
