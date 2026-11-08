/**
 * `pnpm demo:prod` — the demo, but serving the production artifact instead of `next dev`.
 * Roadmap: S6.7 · Spec: DEPLOY.md §1 (`pnpm build` + `pnpm start`), PRD.md FR-22
 *
 * `pnpm demo` is the command a judge is told to run and stays exactly as it is. This is the sibling
 * the e2e suite runs instead, so CI drives the same artifact Phase 8 deploys: it compiles the app
 * with `next build`, then serves it with `next start` in demo mode. Under `next dev` every screen is
 * compiled on its first request, which is a cost the deployed app never pays and the reason the suite
 * once needed a warm-up and a 120 s timeout; a production build has neither, so the suite is faster
 * and tests what ships.
 *
 * Same guards and same seed as `pnpm demo`: it refuses to run where "demo" would be a lie, seeds
 * `./.pglite` and closes the connection before the server opens it (the embedded database gives its
 * directory to one process at a time), and starts with `DEMO_MODE=1` and no worker.
 *
 * `--no-build` reuses an existing `.next` (a local convenience); CI always builds.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import { demoModeConflict } from "../lib/server/adapters";
import { parseEnv } from "../lib/server/env-schema";
import { printSeedReport, seedDemoStory } from "./seed-demo";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

/** Run `next` and resolve with its exit code, so a failed build stops us before we serve it. */
function next(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const child = spawn(process.execPath, [nextBin, ...args], { stdio: "inherit", env });
  return new Promise((resolve) => child.on("exit", (status) => resolve(status ?? 0)));
}

async function main(): Promise<void> {
  const env = parseEnv();
  const conflict = demoModeConflict({ ...env, DEMO_MODE: "1" });
  if (conflict) {
    console.error(`pnpm demo:prod refused to start: ${conflict}`);
    process.exit(1);
  }

  const skipBuild = process.argv.includes("--no-build");
  if (skipBuild && !existsSync(".next/BUILD_ID")) {
    console.error(
      "pnpm demo:prod --no-build needs an existing .next; run it once without the flag.",
    );
    process.exit(1);
  }

  // Build first: it is the only step that may touch .pglite before the seed rewrites it, and a build
  // that fails must stop here rather than serve a stale artifact.
  if (!skipBuild) {
    console.log("demo:prod — building the production artifact (next build)");
    const built = await next(["build"]);
    if (built !== 0) {
      console.error(`pnpm demo:prod stopped: next build exited ${built}`);
      process.exit(built);
    }
  }

  printSeedReport(await seedDemoStory({ fresh: process.argv.includes("--fresh") }));

  const port = new URL(env.PUBLIC_APP_URL).port || "3000";

  console.log("");
  console.log(
    "demo:prod — serving the production build in demo mode (no real quotes, no real money)",
  );
  console.log(
    `  open      http://localhost:${port}/demo   the story, and the button that pays an invoice`,
  );
  console.log(`  also      http://localhost:${port}/       landing page, sign-in, pay flow`);
  console.log("  stop      Ctrl-C");
  console.log("");

  const child = spawn(process.execPath, [nextBin, "start", "--port", port], {
    stdio: "inherit",
    env: { ...process.env, DEMO_MODE: "1" },
  });

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
