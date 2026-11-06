import { defineConfig } from "@playwright/test";

// Runs against demo mode only. Never against real funds.
export default defineConfig({
  testDir: ".",
  /**
   * The suite runs against `next dev`, so the first request to a screen pays for compiling it: a
   * journey that visits six of them needs longer than a production build would.
   */
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm demo",
    url: "http://localhost:3000",
    // Locally, reuse the demo a person already has open; in CI, always start one, so a run can never
    // inherit the state of the run before it.
    reuseExistingServer: !process.env.CI,
    cwd: "..",
    timeout: 180_000,
  },
});
