import { describe, expect, it } from "vitest";

// Roadmap: S3.8, S7.12 (#109)
import { CHALLENGE_TTL_MS, NONCE_MAX_ENTRIES, createNonceStore } from "./nonces";

const HOUR = 60 * 60 * 1000;

describe("challenge store", () => {
  it("accepts a nonce once after issuing it and refuses every repeat", () => {
    const store = createNonceStore({ now: () => 0 });

    const nonce = store.issue("nonce-a");
    expect(nonce).toBe("nonce-a");
    expect(store.use("nonce-a")).toBe(true);
    expect(store.use("nonce-a")).toBe(false);
    expect(store.use("nonce-a")).toBe(false);
  });

  it("refuses a nonce it never issued", () => {
    const store = createNonceStore({ now: () => 0 });

    // The whole point of #109: a captured signature carries a nonce no client could have minted for
    // us, so it is worthless the moment the server, rather than the wallet, decides what is fresh.
    expect(store.use("forged-nonce")).toBe(false);
  });

  it("mints a distinct 32-byte base64 nonce when none is given", () => {
    const store = createNonceStore({ now: () => 0 });

    const first = store.issue();
    const second = store.issue();
    expect(Buffer.from(first, "base64")).toHaveLength(32);
    expect(first).not.toBe(second);
    expect(store.use(first)).toBe(true);
    expect(store.use(second)).toBe(true);
  });

  it("keeps distinct challenges distinct", () => {
    const store = createNonceStore({ now: () => 0 });

    store.issue("nonce-a");
    store.issue("nonce-b");
    expect(store.use("nonce-a")).toBe(true);
    expect(store.use("nonce-b")).toBe(true);
    expect(store.use("nonce-a")).toBe(false);
  });

  it("refuses a challenge once its window has passed", () => {
    let clock = 0;
    const store = createNonceStore({ ttlMs: HOUR, now: () => clock });

    store.issue("nonce-a");
    clock = HOUR + 1;
    expect(store.use("nonce-a")).toBe(false);
  });

  it("holds a spent nonce for the whole window", () => {
    let clock = 0;
    const store = createNonceStore({ ttlMs: HOUR, now: () => clock });

    store.issue("nonce-a");
    expect(store.use("nonce-a")).toBe(true);
    clock = HOUR - 1;
    expect(store.use("nonce-a")).toBe(false);
  });

  it("caps its memory instead of growing with a flood of issued challenges", () => {
    const store = createNonceStore({ maxEntries: 10, ttlMs: HOUR, now: () => 0 });

    let newest = "";
    for (let index = 0; index < 1_000; index += 1) newest = store.issue(`nonce-${index}`);

    expect(store.size()).toBeLessThanOrEqual(10);
    // Only the freshest few survived; the oldest were evicted and now read as never-issued.
    expect(store.use(newest)).toBe(true);
    expect(store.use("nonce-0")).toBe(false);
  });

  it("does not let the default window or cap be weakened below the documented bounds", () => {
    expect(CHALLENGE_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(CHALLENGE_TTL_MS).toBeGreaterThan(0);
    expect(NONCE_MAX_ENTRIES).toBeGreaterThanOrEqual(10_000);
  });

  it("refuses an empty nonce the same as any never-issued one", () => {
    const store = createNonceStore({ now: () => 0 });

    expect(store.use("")).toBe(false);
    store.issue("");
    expect(store.use("")).toBe(true);
    expect(store.use("")).toBe(false);
  });
});
