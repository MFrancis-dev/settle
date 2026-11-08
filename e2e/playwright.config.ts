import { defineConfig } from "@playwright/test";

/**
 * The port the demo binds to. CI leaves it unset and gets 3000; on a dev machine that already runs
 * something else there, set `E2E_PORT` so the suite starts its own demo instead of silently driving
 * the wrong app — `reuseExistingServer` would otherwise adopt whatever answers on 3000.
 */
const port = process.env.E2E_PORT ?? "3000";
const baseURL = `http://localhost:${port}`;

// Runs against demo mode only. Never against real funds.
export default defineConfig({
  testDir: ".",
  /**
   * The suite runs against `next dev`, so the first request to a screen pays for compiling it: a
   * journey that visits six of them needs longer than a production build would.
   */
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: { baseURL },
  webServer: {
    command: "pnpm demo",
    url: baseURL,
    env: { PUBLIC_APP_URL: baseURL },
    // Locally, reuse the demo a person already has open; in CI, always start one, so a run can never
    // inherit the state of the run before it.
    reuseExistingServer: !process.env.CI,
    cwd: "..",
    timeout: 180_000,
  },
});
