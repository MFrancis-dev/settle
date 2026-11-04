// Flat config. Roadmap: S0.4 / K0.4.
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Stubs keep their final signatures; `_`-prefixed params are intentionally unused until built.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Generated output: next-env.d.ts is rewritten by `next build`/`next dev` and is gitignored.
  {
    ignores: [
      ".next/",
      "drizzle/",
      "contracts/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "next-env.d.ts",
    ],
  },
];

export default config;
