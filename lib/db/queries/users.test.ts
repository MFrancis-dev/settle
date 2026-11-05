/**
 * S2.9 — `users` queries against a real Postgres (in-memory PGlite, real migrations).
 * Spec: ARCHITECTURE.md §4
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nextAccountId, openTestDatabase } from "../__fixtures__/testdb";
import { findUserById, findUserByNearAccount, upsertUserByNearAccount } from "./users";
import type { ConnectedDatabase, PgliteDb } from "../client";

let connected: ConnectedDatabase<PgliteDb>;
let db: PgliteDb;

beforeAll(async () => {
  connected = await openTestDatabase();
  db = connected.db;
});

afterAll(async () => {
  await connected.close();
});

describe("upsertUserByNearAccount", () => {
  it("creates the row on a first sign-in", async () => {
    const accountId = nextAccountId("first");
    const user = await upsertUserByNearAccount(db, {
      nearAccountId: accountId,
      displayName: "Ada",
      email: "ada@example.test",
    });

    expect(user).toMatchObject({
      nearAccountId: accountId,
      displayName: "Ada",
      email: "ada@example.test",
      isDemo: false,
    });
    expect(user.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("refreshes the mutable fields on the next sign-in instead of failing on the unique index", async () => {
    // Sign-in happens on every visit, so a returning user must never be a conflict.
    const accountId = nextAccountId("returning");
    const before = await upsertUserByNearAccount(db, {
      nearAccountId: accountId,
      displayName: "Ada",
      email: "ada@example.test",
    });
    const after = await upsertUserByNearAccount(db, {
      nearAccountId: accountId,
      displayName: "Ada Lovelace",
      email: null,
    });

    expect(after.id).toBe(before.id);
    expect(after.displayName).toBe("Ada Lovelace");
    expect(after.email).toBeNull();
    expect(await findUserByNearAccount(db, accountId)).toMatchObject({
      displayName: "Ada Lovelace",
    });
  });

  it("keeps a demo row flagged, so a real payout can never be pointed at one", async () => {
    const user = await upsertUserByNearAccount(db, {
      nearAccountId: nextAccountId("demo"),
      displayName: "Demo Freelancer",
      isDemo: true,
    });
    expect(user.isDemo).toBe(true);
  });

  it("leaves isDemo alone rather than clearing it on a later sign-in", async () => {
    const accountId = nextAccountId("flag");
    await upsertUserByNearAccount(db, {
      nearAccountId: accountId,
      displayName: "Demo",
      isDemo: true,
    });
    const refreshed = await upsertUserByNearAccount(db, {
      nearAccountId: accountId,
      displayName: "Demo Again",
    });
    expect(refreshed.isDemo).toBe(true);
  });
});

describe("lookups", () => {
  it("finds a user by either key", async () => {
    const accountId = nextAccountId("both");
    const created = await upsertUserByNearAccount(db, {
      nearAccountId: accountId,
      displayName: "Both",
    });
    expect((await findUserById(db, created.id))?.nearAccountId).toBe(accountId);
    expect((await findUserByNearAccount(db, accountId))?.id).toBe(created.id);
  });

  it("returns null for an id that does not exist, rather than throwing on the first row", async () => {
    expect(await findUserById(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await findUserByNearAccount(db, "nobody.testnet")).toBeNull();
  });
});
