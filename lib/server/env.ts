import "server-only";

/**
 * Validated environment. Everything optional so `pnpm demo` runs with no .env.
 * Roadmap: S0.6 · Spec: ARCHITECTURE.md §8
 * Status: scaffold — not implemented yet.
 */

import { z } from "zod";

const schema = z.object({
  ONECLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  ONECLICK_JWT: z.string().optional(),
  NEAR_RPC_URL: z.string().url().optional(),
  USDC_CONTRACT_ID: z.string().optional(),
  STORAGE_PAYER_ACCOUNT_ID: z.string().optional(),
  STORAGE_PAYER_PRIVATE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
