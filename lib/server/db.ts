/**
 * Turns the environment into a database connection, and shares one per process.
 * Roadmap: S0.5 · Spec: ARCHITECTURE.md §2, §8
 *
 * No `server-only` marker: `worker/` and the tsx scripts use the same accessor, and
 * that package throws under plain Node. Client components must never import this.
 */

import {
  createDatabase,
  DEFAULT_PGLITE_DIR,
  type ConnectedDatabase,
  type DatabaseConfig,
} from "../db/client";
import { parseEnv } from "./env-schema";

export function databaseConfig(
  source: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  return { url: parseEnv(source).DATABASE_URL, dataDir: DEFAULT_PGLITE_DIR };
}

let connection: Promise<ConnectedDatabase> | undefined;

/** The connection for this process, engine chosen from the environment. */
export function getDatabase(): Promise<ConnectedDatabase> {
  connection ??= createDatabase(databaseConfig());
  return connection;
}

export async function closeDatabase(): Promise<void> {
  const active = await connection;
  connection = undefined;
  await active?.close();
}
