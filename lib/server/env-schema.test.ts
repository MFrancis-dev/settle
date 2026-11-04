import { describe, expect, it } from "vitest";

import {
  isPostgresConfigured,
  missingRealModeKeys,
  parseEnv,
  unsetOptionalKeys,
} from "./env-schema";

describe("env-schema", () => {
  it("parses an empty environment into demo-mode defaults", () => {
    const env = parseEnv({});
    expect(env.ONECLICK_BASE_URL).toBe("https://1click.chaindefuser.com");
    expect(env.PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(missingRealModeKeys(env)).toEqual(["SESSION_SECRET", "ONECLICK_JWT", "NEAR_RPC_URL"]);
  });

  it("treats an empty value from `.env` as unset, not as a value", () => {
    const env = parseEnv({ SESSION_SECRET: "", DATABASE_URL: "  ", ONECLICK_JWT: "jwt" });
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(isPostgresConfigured(env)).toBe(false);
    expect(missingRealModeKeys(env)).toEqual(["SESSION_SECRET", "NEAR_RPC_URL"]);
  });

  it("rejects a too-short session secret and names the key without the value", () => {
    expect(() => parseEnv({ SESSION_SECRET: "short" })).toThrowError(/SESSION_SECRET/);
    expect(() => parseEnv({ SESSION_SECRET: "short" })).not.toThrowError(/short/);
  });

  it("accepts a 32-character session secret and reports nothing missing", () => {
    const secret = "a".repeat(32);
    const env = parseEnv({
      SESSION_SECRET: secret,
      ONECLICK_JWT: "jwt",
      NEAR_RPC_URL: "https://rpc.test",
    });
    expect(missingRealModeKeys(env)).toEqual([]);
    expect(unsetOptionalKeys(env)).toContain("DATABASE_URL");
  });

  it("switches to Postgres only when DATABASE_URL is set", () => {
    expect(isPostgresConfigured(parseEnv({ DATABASE_URL: "postgres://x/y" }))).toBe(true);
  });
});
