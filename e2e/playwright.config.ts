import { defineConfig } from "@playwright/test";

// Runs against demo mode only. Never against real funds.
export default defineConfig({
  testDir: ".",
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "pnpm demo", url: "http://localhost:3000", reuseExistingServer: true, cwd: ".." },
});
