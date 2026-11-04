import "server-only";

/**
 * Validated environment, parsed once per server process. Demo mode runs with no `.env`
 * at all, so every key is optional; real mode fails loudly in `check-env`.
 * Roadmap: S0.6 · Spec: ARCHITECTURE.md §8
 */

import { parseEnv, type Env } from "./env-schema";

export const env: Env = parseEnv();
export type { Env };
