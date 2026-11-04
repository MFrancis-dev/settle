import { describe, expect, it } from "vitest";

import { DEFAULT_PGLITE_DIR } from "../db/client";
import { databaseConfig } from "./db";

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
