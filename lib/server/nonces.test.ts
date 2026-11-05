import { describe, expect, it } from "vitest";

// Roadmap: S3.8
import { NONCE_MAX_ENTRIES, createNonceStore } from "./nonces";

const HOUR = 60 * 60 * 1000;

describe("nonce store", () => {
  it("accepts a nonce once and refuses every repeat", () => {
    const store = createNonceStore({ now: () => 0 });

    expect(store.use("nonce-a")).toBe(true);
    expect(store.use("nonce-a")).toBe(false);
    expect(store.use("nonce-a")).toBe(false);
    expect(store.size()).toBe(1);
  });

  it("keeps distinct nonces distinct", () => {
    const store = createNonceStore({ now: () => 0 });

    expect(store.use("nonce-a")).toBe(true);
    expect(store.use("nonce-b")).toBe(true);
    expect(store.use("nonce-a")).toBe(false);
    expect(store.size()).toBe(2);
  });

  it("forgets a nonce once it is older than the window", () => {
    let clock = 0;
    const store = createNonceStore({ ttlMs: HOUR, now: () => clock });

    expect(store.use("nonce-a")).toBe(true);
    clock = HOUR + 1;
    // Same nonce, but the entry has aged out: it is a new nonce as far as the guard is concerned.
    expect(store.use("nonce-a")).toBe(true);
  });

  it("holds a nonce for the whole window", () => {
    let clock = 0;
    const store = createNonceStore({ ttlMs: HOUR, now: () => clock });

    store.use("nonce-a");
    clock = HOUR - 1;
    expect(store.use("nonce-a")).toBe(false);
  });

  it("caps its memory instead of growing with a flood of unique nonces", () => {
    const store = createNonceStore({ maxEntries: 10, ttlMs: HOUR, now: () => 0 });

    for (let index = 0; index < 1_000; index += 1) {
      store.use(`nonce-${index}`);
    }

    expect(store.size()).toBeLessThanOrEqual(10);
  });

  it("evicts the oldest first, so the freshest nonce is still refused", () => {
    let clock = 0;
    const store = createNonceStore({ maxEntries: 3, ttlMs: HOUR, now: () => clock });

    store.use("old");
    clock += 1;
    store.use("mid");
    clock += 1;
    store.use("new");
    clock += 1;
    store.use("newer");

    expect(store.use("new")).toBe(false);
    expect(store.use("old")).toBe(true);
  });

  it("does not let the default cap shrink below the documented bound", () => {
    expect(NONCE_MAX_ENTRIES).toBeGreaterThanOrEqual(10_000);
  });

  it("treats an empty nonce as any other string", () => {
    const store = createNonceStore({ now: () => 0 });

    expect(store.use("")).toBe(true);
    expect(store.use("")).toBe(false);
  });
});
