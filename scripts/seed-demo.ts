/**
 * Writes the demo story into the configured database, then prints it.
 * Roadmap: S6.3 · Spec: PRD.md FR-22, ARCHITECTURE.md §7
 *
 * `pnpm demo` runs this before it starts the app, because the embedded database hands its data
 * directory to one process at a time: seed in a step that closes the connection, then start `next dev`
 * on the same `./.pglite`.
 *
 * Running it twice leaves the story alone: the first run writes it, later runs read it back, so a
 * judge who restarts the app mid-talk keeps the payments they have already walked rather than being
 * handed fresh pay links that contradict the ones on the projector. `--fresh` is what rewrites it —
 * which is also what the "Restart the story" button on `/demo` does from the browser.
 */

import { pathToFileURL } from "node:url";

import { closeDatabase, getDatabase } from "../lib/server/db";
import { assertDemoModeAllowed, demoSeedOptions } from "../lib/server/adapters";
import { parseEnv, type Env } from "../lib/server/env-schema";
import {
  DEMO_ACCOUNT_ID,
  DEMO_DISPLAY_NAME,
  DEMO_EMAIL,
  DEMO_PAYOUT_ADDRESS,
  clearDemoData,
  readDemoStory,
  seedDemo,
  type DemoSeed,
} from "../lib/db/seed-demo";

export interface SeedReport {
  env: Env;
  seed: DemoSeed;
  /** True when the story was already there and was left exactly as it was. */
  reused: boolean;
}

/**
 * Write the story if it is not there yet, and close the database before returning so the caller may
 * hand the same data directory to another process (the embedded database is single-reader).
 */
export async function seedDemoStory(options: { fresh?: boolean } = {}): Promise<SeedReport> {
  const env = parseEnv();
  // The same refusal the app enforces per request, one step earlier and with a readable message: a
  // seed only ever makes sense in demo mode, so `DATABASE_URL` next to it is a mistake worth naming.
  assertDemoModeAllowed({ ...env, DEMO_MODE: "1" });

  const { db } = await getDatabase();
  const existing = options.fresh ? null : await readDemoStory(db);
  let seed = existing;
  if (seed === null) {
    await clearDemoData(db);
    seed = await seedDemo(db, demoSeedOptions(Date.now));
  }
  await closeDatabase();

  return { env, seed, reused: existing !== null };
}

export function printSeedReport(report: SeedReport): void {
  const base = report.env.PUBLIC_APP_URL.replace(/\/+$/, "");
  console.log("seed-demo — the fictional freelancer");
  if (report.reused) {
    console.log("  story     already in this database, left as it was (`--fresh` rewrites it)");
  }
  console.log(`  account   ${DEMO_ACCOUNT_ID} (${DEMO_DISPLAY_NAME}, ${DEMO_EMAIL})`);
  console.log(`  paid out  USDC on NEAR to ${DEMO_PAYOUT_ADDRESS}`);
  console.log(`  invoices  ${report.seed.invoices.length}, one per status the app can reach:`);
  for (const invoice of report.seed.invoices) {
    console.log(
      `    ${invoice.status.padEnd(17)} ${invoice.clientName.padEnd(17)} ${base}/pay/${invoice.publicId}`,
    );
  }
}

async function main(): Promise<void> {
  printSeedReport(await seedDemoStory({ fresh: process.argv.includes("--fresh") }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
