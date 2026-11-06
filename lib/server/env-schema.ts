/**
 * Environment variable names + validation. Values are never stored or logged here.
 *
 * This module deliberately has no `server-only` marker: that package throws when
 * required by plain Node, and the tsx dev scripts (check-env, seed-demo) must share
 * these names. `lib/server/env.ts` adds the marker and the parsed singleton.
 * Roadmap: S0.6 · Spec: ARCHITECTURE.md §8
 */

import { z } from "zod";

const url = (fallback: string) => z.string().url().default(fallback);

export const envSchema = z.object({
  ONECLICK_BASE_URL: url("https://1click.chaindefuser.com"),
  ONECLICK_JWT: z.string().min(1).optional(),
  /**
   * The vendor key that signs quotes. Absent means the key built into the SDK (the production
   * manager); it is settable only so a documented rotation does not need a code change.
   */
  ONECLICK_MANAGER_PUBLIC_KEY: z.string().startsWith("ed25519:").optional(),
  NEAR_RPC_URL: z.string().url().optional(),
  USDC_CONTRACT_ID: z.string().min(1).optional(),
  STORAGE_PAYER_ACCOUNT_ID: z.string().min(1).optional(),
  STORAGE_PAYER_PRIVATE_KEY: z.string().min(1).optional(),
  /** Absent → embedded PGlite. Present → hosted Postgres. */
  DATABASE_URL: z.string().min(1).optional(),
  /**
   * Set by `pnpm demo` and nothing else: the process serves fictional data and simulates payments.
   * `lib/server/adapters.ts` refuses to honour it next to `DATABASE_URL` or a public `PUBLIC_APP_URL`,
   * so a demo can never be a property of a deployment that takes real money.
   */
  DEMO_MODE: z.enum(["1", "true", "0", "false"]).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  PUBLIC_APP_URL: url("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

/** Which names real (non-demo) mode needs before it will work end to end. */
export const REAL_MODE_REQUIRED = ["SESSION_SECRET", "ONECLICK_JWT", "NEAR_RPC_URL"] as const;

/** Set these only for a hosted deployment; demo mode runs without any of them. */
export const REAL_MODE_OPTIONAL = [
  "DATABASE_URL",
  "USDC_CONTRACT_ID",
  "ONECLICK_MANAGER_PUBLIC_KEY",
  "STORAGE_PAYER_ACCOUNT_ID",
  "STORAGE_PAYER_PRIVATE_KEY",
] as const;

/** `.env` files leave `KEY=` for unset values; an empty string is not a value. */
function pruneBlanks(source: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(pruneBlanks(source));
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".") || "value");
    throw new Error(
      `Invalid environment: ${names.join(", ")}. Fix the values (never print them) and retry.`,
    );
  }
  return parsed.data;
}

/** Names only — a missing-value report must never echo what the value was. */
export function missingRealModeKeys(env: Env): string[] {
  return REAL_MODE_REQUIRED.filter((name) => env[name] === undefined);
}

export function unsetOptionalKeys(env: Env): string[] {
  return REAL_MODE_OPTIONAL.filter((name) => env[name] === undefined);
}

export function isPostgresConfigured(env: Env): boolean {
  return env.DATABASE_URL !== undefined;
}

export function isOneClickJwtConfigured(env: Env): boolean {
  return env.ONECLICK_JWT !== undefined;
}

/** Whether this process is a demo. `DEMO_MODE=0` is off, so an override in a shell profile is safe. */
export function isDemoMode(env: Env): boolean {
  return env.DEMO_MODE === "1" || env.DEMO_MODE === "true";
}
