// @vitest-environment node
/**
 * `?next=` is somebody else's URL that the app pushes onto the router, so it is checked.
 * Roadmap: S4.8 · Spec: ARCHITECTURE.md §5
 */

import { describe, expect, it } from "vitest";

import { returnPath } from "./return-path";

describe("returnPath", () => {
  it("returns a page inside the signed-in app", () => {
    expect(returnPath("/dashboard")).toBe("/dashboard");
    expect(returnPath("/settings")).toBe("/settings");
    expect(returnPath("/invoices/new")).toBe("/invoices/new");
    expect(returnPath("/invoices?status=open")).toBe("/invoices?status=open");
  });

  it("takes the first value when the query repeated the parameter", () => {
    expect(returnPath(["/settings", "/dashboard"])).toBe("/settings");
  });

  it("drops an absent parameter", () => {
    expect(returnPath(undefined)).toBeNull();
    expect(returnPath([])).toBeNull();
  });

  it.each([
    ["another origin", "//evil.test/settings"],
    ["a backslash, which the router also reads as external", "/\\evil.test/settings"],
    ["an absolute URL", "https://evil.test/settings"],
    ["a page nobody was redirected from", "/pay/some-invoice"],
    ["a prefix that only looks like a gated page", "/settings-export"],
    ["an empty string", ""],
  ])("drops %s", (_name, value) => {
    expect(returnPath(value)).toBeNull();
  });
});
