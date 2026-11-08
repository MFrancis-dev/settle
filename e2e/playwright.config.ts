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
   * The suite runs against a production build (`next start`), so every route is already compiled and
   * a screen costs what it costs the deployed app — no on-demand compile, no warm-up. The budget is
   * for the journey itself, not for `next dev` building a page under it.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL },
  webServer: {
    // `pnpm demo:prod` builds the artifact Phase 8 deploys and serves it in demo mode, so CI drives
    // what ships rather than a dev server. `pnpm demo` (next dev) is the judge's command and is
    // untouched; this is its production sibling.
    command: "pnpm demo:prod",
    url: baseURL,
    env: { PUBLIC_APP_URL: baseURL },
    // Locally, reuse a demo a person already has open; in CI, always build and start a fresh one, so
    // a run can never inherit the state — or the artifact — of the run before it.
    reuseExistingServer: !process.env.CI,
    cwd: "..",
    // Covers `next build` (~24 s locally, more on a shared runner) before the server can answer.
    timeout: 300_000,
  },
});
