import { describe, expect, it } from "vitest";

// Roadmap: S3.8
import { QUOTE_LIMIT, STATUS_LIMIT, createRateLimiter } from "./rateLimit";

const MINUTE = 60_000;

function limiter(capacity: number, windowMs = MINUTE) {
  let clock = 0;
  const check = createRateLimiter({ capacity, windowMs, now: () => clock });
  return { check, advance: (ms: number) => (clock += ms) };
}

describe("rate limiter", () => {
  it("lets a burst up to the capacity through, then refuses", () => {
    const { check } = limiter(6);

    for (let index = 0; index < 6; index += 1) {
      expect(check.check("pay-page").allowed).toBe(true);
    }
    expect(check.check("pay-page").allowed).toBe(false);
  });

  it("refuses one caller without touching another", () => {
    const { check } = limiter(1);

    expect(check.check("a").allowed).toBe(true);
    expect(check.check("b").allowed).toBe(true);
    expect(check.check("a").allowed).toBe(false);
  });

  it("refills at the configured rate", () => {
    const { check, advance } = limiter(2, MINUTE);

    check.check("k");
    check.check("k");
    expect(check.check("k").allowed).toBe(false);

    // Half the window puts exactly one token back.
    advance(MINUTE / 2);
    expect(check.check("k").allowed).toBe(true);
    expect(check.check("k").allowed).toBe(false);
  });

  it("never refills past the capacity", () => {
    const { check, advance } = limiter(3, MINUTE);

    advance(10 * MINUTE);
    for (let index = 0; index < 3; index += 1) {
      expect(check.check("k").allowed).toBe(true);
    }
    expect(check.check("k").allowed).toBe(false);
  });

  it("says how long the caller must wait, in whole seconds", () => {
    const { check } = limiter(1, MINUTE);

    check.check("k");
    const decision = check.check("k");

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterS).toBe(60);
  });

  it("shortens the wait as the bucket refills", () => {
    const { check, advance } = limiter(1, MINUTE);

    check.check("k");
    advance(40_000);
    expect(check.check("k").retryAfterS).toBe(20);
  });

  it("forgets a key on reset", () => {
    const { check } = limiter(1);

    check.check("k");
    expect(check.check("k").allowed).toBe(false);

    check.reset("k");
    expect(check.check("k").allowed).toBe(true);
  });

  it("clears every key when reset has no argument", () => {
    const { check } = limiter(1);

    check.check("a");
    check.check("b");
    check.reset();

    expect(check.check("a").allowed).toBe(true);
    expect(check.check("b").allowed).toBe(true);
  });

  it("matches the limits the spec names for the quote and status polls", () => {
    expect(QUOTE_LIMIT).toEqual({ capacity: 6, windowMs: MINUTE });
    expect(STATUS_LIMIT).toEqual({ capacity: 60, windowMs: MINUTE });
  });
});
