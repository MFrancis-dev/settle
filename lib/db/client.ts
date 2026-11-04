/**
 * DB engine selection: PGlite when DATABASE_URL is empty, Postgres when it is set.
 * Roadmap: S0.5 · Spec: ARCHITECTURE.md §2, §4 · project_structure.md §1
 *
 * Pure driver code — it reads no environment, because `lib/db` may not import
 * `lib/server`; `lib/server/db.ts` supplies the config and the shared connection.
 * No `server-only` marker either: the worker and the tsx scripts build this client,
 * and that package throws under plain Node.
 *
 * The two engines return distinct Drizzle types (their query-result HKTs differ), so
 * callers pick one branch instead of holding an unusable union.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase as PgliteDrizzle } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase as PostgresJsDrizzle,
} from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "./schema";

export const MIGRATIONS_FOLDER = "./drizzle";
export const DEFAULT_PGLITE_DIR = "./.pglite";

export type PgliteDb = PgliteDrizzle<typeof schema>;
export type PostgresDb = PostgresJsDrizzle<typeof schema>;
export type Database = PgliteDb | PostgresDb;
export type DatabaseDriver = "pglite" | "postgres";

export interface DatabaseConfig {
  /** Hosted Postgres. Omit to use the embedded PGlite directory instead. */
  url?: string;
  dataDir?: string;
  migrationsFolder?: string;
}

export interface ConnectedDatabase<TDb extends Database = Database> {
  db: TDb;
  driver: DatabaseDriver;
  close(): Promise<void>;
}

export function createDatabase(
  config: DatabaseConfig & { url: string },
): Promise<ConnectedDatabase<PostgresDb>>;
export function createDatabase(config?: DatabaseConfig): Promise<ConnectedDatabase<PgliteDb>>;

/** Opens the right engine for the config and applies any pending migrations. */
export async function createDatabase(
  config: DatabaseConfig = {},
): Promise<ConnectedDatabase<PostgresDb> | ConnectedDatabase<PgliteDb>> {
  const migrationsFolder = config.migrationsFolder ?? MIGRATIONS_FOLDER;

  if (config.url) {
    const client = postgres(config.url, { max: 5 });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder });
    return { db, driver: "postgres", close: () => client.end({ timeout: 5 }) };
  }

  const client = new PGlite(config.dataDir ?? DEFAULT_PGLITE_DIR);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, driver: "pglite", close: () => client.close() };
}
