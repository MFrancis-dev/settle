import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Roadmap: S8.3 · a host points its health check here, so the two answers it can get are pinned:
// green when the database can be read, 503 when it cannot.
import { GET } from "./route";
import { openTestDatabase } from "@/lib/db/__fixtures__/testdb";
import { clearServerDeps, createServerDeps, installServerDeps } from "@/lib/server/deps";
import { createRouteHarness, jsonOf, type RouteHarness } from "@/lib/server/__fixtures__/routes";

let harness: RouteHarness;

// The probe reports the *process* environment, so this suite models the deployment it is written
// for: `pnpm demo` locally, and the hosted demo of S8.3. Without it `demo` reads false here even
// though the harness deps are demo-mode ones — the two are deliberately separate questions.
let previousDemoMode: string | undefined;

beforeAll(async () => {
  previousDemoMode = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "1";
  harness = await createRouteHarness();
});

afterEach(() => {
  // a degraded test installs its own deps; hand the process back the harness ones
  installServerDeps(harness.deps);
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = previousDemoMode;
  clearServerDeps();
  await harness?.close();
});

describe("GET /api/health", () => {
  it("answers ok, and says which run mode the process is in", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ status: "ok", demo: true, database: "ok" });
  });

  it("answers exactly three fields, so a probe cannot become a disclosure", async () => {
    const body = await jsonOf(await GET());

    expect(Object.keys(body).sort()).toEqual(["database", "demo", "status"]);
    // no host name, no DATABASE_URL, no version, no upstream state — nothing a scanner can use
    expect(JSON.stringify(body)).not.toMatch(/postgres|pglite|DATABASE_URL|http/i);
  });

  it("is never cached, so a recovered database shows up on the next probe", async () => {
    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 503 degraded when the database cannot be read", async () => {
    // a real connection, closed before the probe: the failure is the driver's own, not a stub's
    const closed = await openTestDatabase();
    await closed.close();
    installServerDeps(createServerDeps({ db: closed.db }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await jsonOf(response)).toEqual({
      status: "degraded",
      demo: true,
      database: "unreachable",
    });
    // the reason goes to the server log, where a deployer can read it
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("health: not ok —"));
  });

  it("answers 503 JSON, not a framework error page, when the environment cannot be parsed", async () => {
    // `DEMO_MODE` is an enum, so a typo makes `parseEnv` throw — the state a fresh deploy is most
    // likely to be in when someone first probes it. With no deps installed the route reaches the
    // environment itself, which is where the guard has to hold.
    const previous = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "yes";
    clearServerDeps();
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      expect(await jsonOf(response)).toEqual({
        status: "degraded",
        demo: false,
        database: "unreachable",
      });
    } finally {
      if (previous === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previous;
    }
  });
});
