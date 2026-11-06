/**
 * `pnpm demo` — seed the fictional freelancer, then run the app in demo mode.
 * Roadmap: S6.3, S6.5 · Spec: PRD.md FR-22, ARCHITECTURE.md §7, §8
 *
 * One command, no `.env`, no keys, no external database (S6.5). What it does:
 * 1. refuses to run if the environment would make "demo" a lie — `DATABASE_URL` set, or a public
 *    `PUBLIC_APP_URL` — with the reason printed rather than a stack trace;
 * 2. seeds `./.pglite` through `scripts/seed-demo.ts`, then closes the connection, because the
 *    embedded database gives its data directory to one process at a time — and leaves a story that is
 *    already there alone, so restarting mid-talk keeps the payments already walked (`--fresh` rewrites);
 * 3. starts `next dev` with `DEMO_MODE=1`, which is the only thing that flips the app's 1Click
 *    transport to the demo one (`lib/server/adapters.ts`).
 *
 * The worker is not started. In demo mode the service's status answers are a mirror of the database,
 * so polling would only re-read what the "simulate payment" button wrote; `pnpm worker` runs the real
 * loops against the same demo data whenever you want to watch them.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { demoModeConflict } from "../lib/server/adapters";
import { parseEnv } from "../lib/server/env-schema";
import { printSeedReport, seedDemoStory } from "./seed-demo";

async function main(): Promise<void> {
  const env = parseEnv();
  const conflict = demoModeConflict({ ...env, DEMO_MODE: "1" });
  if (conflict) {
    console.error(`pnpm demo refused to start: ${conflict}`);
    process.exit(1);
  }

  printSeedReport(await seedDemoStory({ fresh: process.argv.includes("--fresh") }));

  const port = new URL(env.PUBLIC_APP_URL).port || "3000";
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

  console.log("");
  console.log("demo — starting the app in demo mode (no real quotes, no real money)");
  console.log(
    `  open      http://localhost:${port}/demo   the story, and the button that pays an invoice`,
  );
  console.log(`  also      http://localhost:${port}/       landing page, sign-in, pay flow`);
  console.log("  stop      Ctrl-C");
  console.log("");

  const child = spawn(process.execPath, [nextBin, "dev", "--port", port], {
    stdio: "inherit",
    env: { ...process.env, DEMO_MODE: "1" },
  });

  // Ctrl-C reaches the child directly (stdio is inherited); this only keeps the parent from lingering.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }

  const code = await new Promise<number>((resolve) => {
    child.on("exit", (status) => resolve(status ?? 0));
  });
  process.exit(code);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
