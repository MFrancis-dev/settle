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
  if (connection === undefined) {
    connection = createDatabase(databaseConfig());
    // A failed open must not stay cached: every later request would be handed the same rejection, so
    // one bad start (or one bad `DATABASE_URL`) would take the app down until a restart. The handler
    // also marks the rejection handled, so an idle failure is logged by the caller, not by the process.
    connection.catch(() => {
      connection = undefined;
    });
  }
  return connection;
}

export async function closeDatabase(): Promise<void> {
  const opening = connection;
  connection = undefined;
  if (opening === undefined) return;
  const opened = await opening.catch(() => undefined);
  await opened?.close();
}
