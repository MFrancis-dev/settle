import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase } from "./client";
import { users } from "./schema";

/**
 * Proves the Drizzle wiring on each engine: migrate, write, read back. The two dialects
 * are not interchangeable as types, so the same trip is written once per engine.
 *
 * Account ids are unique per run: these tests also run against a database that already
 * has rows (a hosted Postgres on every deploy), and `near_account_id` is unique.
 */
const freshAccount = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}.test-net`;

describe("db/client (PGlite)", () => {
  it("runs a query against the embedded database", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "settle-pglite-"));
    const accountId = freshAccount("pglite");
    const connected = await createDatabase({ dataDir: dir });

    try {
      expect(connected.driver).toBe("pglite");
      await connected.db.insert(users).values({ nearAccountId: accountId, displayName: "Test" });
      const rows = await connected.db
        .select({ nearAccountId: users.nearAccountId, isDemo: users.isDemo })
        .from(users)
        .where(eq(users.nearAccountId, accountId))
        .limit(1);
      expect(rows).toEqual([{ nearAccountId: accountId, isDemo: false }]);
    } finally {
      await connected.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Real Postgres only exists when DATABASE_URL points at one; CI runs the PGlite half.
describe.skipIf(!process.env.DATABASE_URL)("db/client (Postgres)", () => {
  it("runs the same query against Postgres", async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("unreachable: the suite is skipped without DATABASE_URL");
    const accountId = freshAccount("postgres");
    const connected = await createDatabase({ url });

    try {
      expect(connected.driver).toBe("postgres");
      await connected.db.insert(users).values({ nearAccountId: accountId, displayName: "Test" });
      const rows = await connected.db
        .select({ nearAccountId: users.nearAccountId, isDemo: users.isDemo })
        .from(users)
        .where(eq(users.nearAccountId, accountId))
        .limit(1);
      expect(rows).toEqual([{ nearAccountId: accountId, isDemo: false }]);
    } finally {
      await connected.close();
    }
  });
});
