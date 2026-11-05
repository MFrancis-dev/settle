import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  // Next requires `jsx: "preserve"` in tsconfig, which would leave JSX untransformed here, so the
  // transform is set for the test runner only. Component tests opt into jsdom with a
  // `@vitest-environment jsdom` docblock; everything else stays on the default node environment.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "e2e", "contracts"],
  },
});
