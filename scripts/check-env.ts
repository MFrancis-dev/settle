/**
 * Prints which env vars are missing for real (non-demo) mode. Never prints values.
 * Exit code 1 means "not ready for a real deployment"; demo mode ignores this script.
 * Roadmap: S0.6 / K0.6 · Spec: ARCHITECTURE.md §8
 */

import {
  isPostgresConfigured,
  missingRealModeKeys,
  parseEnv,
  REAL_MODE_REQUIRED,
  unsetOptionalKeys,
} from "../lib/server/env-schema";

const env = parseEnv();
const missing = missingRealModeKeys(env);
const unsetOptional = unsetOptionalKeys(env);

console.log("check-env — real (non-demo) mode");
console.log(`  required: ${REAL_MODE_REQUIRED.join(", ")}`);

if (missing.length > 0) {
  console.log(`  MISSING  ${missing.join(", ")}`);
} else {
  console.log("  all required keys present");
}

if (unsetOptional.length > 0) {
  console.log(
    `  optional (unset): ${unsetOptional.join(", ")} — ` +
      (isPostgresConfigured(env)
        ? "Postgres in use"
        : "embedded PGlite in use (fine for local + demo)"),
  );
}

if (missing.length > 0) {
  console.log("Verdict: NOT ready for real mode. Demo mode still works.");
  process.exit(1);
}
console.log("Verdict: ready for real mode.");
