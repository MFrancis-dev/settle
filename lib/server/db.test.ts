import { describe, expect, it } from "vitest";

import { DEFAULT_PGLITE_DIR } from "../db/client";
import { closeDatabase, databaseConfig, getDatabase } from "./db";

describe("databaseConfig", () => {
  it("leaves the url unset when DATABASE_URL is blank, which selects PGlite", () => {
    expect(databaseConfig({ DATABASE_URL: "" }).url).toBeUndefined();
    expect(databaseConfig({}).url).toBeUndefined();
  });

  it("passes a configured DATABASE_URL through to Postgres", () => {
    expect(databaseConfig({ DATABASE_URL: "postgres://host/db" }).url).toBe("postgres://host/db");
  });

  it("keeps the embedded database in the gitignored local directory", () => {
    expect(databaseConfig({}).dataDir).toBe(DEFAULT_PGLITE_DIR);
  });
});

describe("getDatabase", () => {
  it("does not keep a failed connection, so the next request tries again", async () => {
    const previous = process.env.DATABASE_URL;
    // Port 1 refuses immediately: a real failure, without waiting on a host that may exist.
    process.env.DATABASE_URL = "postgres://127.0.0.1:1/settle";
    try {
      const first = getDatabase();
      await expect(first).rejects.toThrow();

      const second = getDatabase();
      expect(second, "a cached rejection would be the same promise").not.toBe(first);
      await expect(second).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      await closeDatabase();
    }
  });
});
