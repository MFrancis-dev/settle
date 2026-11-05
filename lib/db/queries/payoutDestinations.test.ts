/**
 * S2.9 — `payout_destinations` queries: history, and the one-active-row rule.
 * Spec: ARCHITECTURE.md §4, §5
 *
 * Two active rows would let a quote be built against an address the freelancer no longer owns,
 * and an edited address would change where an already-agreed invoice pays — hence the
 * deactivate-and-insert transaction and these tests.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";

import { payoutDestinations } from "../schema";
import { openTestDatabase, seedUser } from "../__fixtures__/testdb";
import type { ConnectedDatabase, PgliteDb } from "../client";
import {
  findDestinationById,
  getActiveDestination,
  listDestinations,
  setActiveDestination,
} from "./payoutDestinations";

let connected: ConnectedDatabase<PgliteDb>;
let db: PgliteDb;

beforeAll(async () => {
  connected = await openTestDatabase();
  db = connected.db;
});

afterAll(async () => {
  await connected.close();
});

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

async function activeCount(userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(payoutDestinations)
    .where(and(eq(payoutDestinations.userId, userId), eq(payoutDestinations.active, true)));
  return rows[0]?.n ?? 0;
}

describe("setActiveDestination", () => {
  it("activates the first address for a user with none", async () => {
    const user = await seedUser(db);
    const row = await setActiveDestination(db, {
      userId: user.id,
      assetId: USDC,
      chain: "near",
      address: "freelancer.testnet",
    });

    expect(row).toMatchObject({ address: "freelancer.testnet", active: true });
    expect(row.deactivatedAt).toBeNull();
    expect(await activeCount(user.id)).toBe(1);
  });

  it("keeps the previous address as history when it changes", async () => {
    const user = await seedUser(db);
    const first = await setActiveDestination(db, {
      userId: user.id,
      assetId: USDC,
      chain: "near",
      address: "one.testnet",
    });
    const second = await setActiveDestination(db, {
      userId: user.id,
      assetId: USDC,
      chain: "near",
      address: "two.testnet",
    });

    expect(second.id).not.toBe(first.id);
    expect(await activeCount(user.id)).toBe(1);
    expect((await getActiveDestination(db, user.id))?.address).toBe("two.testnet");

    const retired = await findDestinationById(db, first.id);
    expect(retired).toMatchObject({ address: "one.testnet", active: false });
    expect(retired?.deactivatedAt).toBeInstanceOf(Date);
    expect(await listDestinations(db, user.id)).toHaveLength(2);
  });

  it("is a no-op when the same address is saved again", async () => {
    const user = await seedUser(db);
    const input = { userId: user.id, assetId: USDC, chain: "near", address: "same.testnet" };
    const first = await setActiveDestination(db, input);
    const again = await setActiveDestination(db, input);

    expect(again.id).toBe(first.id);
    expect(await listDestinations(db, user.id)).toHaveLength(1);
  });

  it("treats a different asset or chain at the same address as a new destination", async () => {
    // The same string on another chain is a different place for money to arrive.
    const user = await seedUser(db);
    const near = await setActiveDestination(db, {
      userId: user.id,
      assetId: USDC,
      chain: "near",
      address: "bc1qexample",
    });
    const solana = await setActiveDestination(db, {
      userId: user.id,
      assetId: "sol:USDC",
      chain: "sol",
      address: "bc1qexample",
    });

    expect(solana.id).not.toBe(near.id);
    expect(await activeCount(user.id)).toBe(1);
  });

  it("gives each user their own active address", async () => {
    const a = await seedUser(db);
    const b = await seedUser(db);
    await setActiveDestination(db, {
      userId: a.id,
      assetId: USDC,
      chain: "near",
      address: "a.testnet",
    });
    await setActiveDestination(db, {
      userId: b.id,
      assetId: USDC,
      chain: "near",
      address: "b.testnet",
    });

    expect((await getActiveDestination(db, a.id))?.address).toBe("a.testnet");
    expect((await getActiveDestination(db, b.id))?.address).toBe("b.testnet");
  });
});

describe("lookups", () => {
  it("returns null when a freelancer has never set a payout address", async () => {
    const user = await seedUser(db);
    expect(await getActiveDestination(db, user.id)).toBeNull();
    expect(await listDestinations(db, user.id)).toEqual([]);
  });

  it("returns the newest active row even after a retire-and-replace", async () => {
    const user = await seedUser(db);
    const input = { userId: user.id, assetId: USDC, chain: "near" };
    await setActiveDestination(db, { ...input, address: "old.testnet" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await setActiveDestination(db, { ...input, address: "new.testnet" });

    // `createdAt` descending, so a retired row can never win the lookup.
    expect((await getActiveDestination(db, user.id))?.address).toBe("new.testnet");
    expect((await listDestinations(db, user.id))[0]?.address).toBe("new.testnet");
  });
});
