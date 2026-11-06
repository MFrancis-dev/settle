// @vitest-environment jsdom
/**
 * The clock on a price: what it says, what a screen reader hears, and that it fires its expiry once.
 * Roadmap: S4.8 · Spec: PRD FR-15 (the quote expires and says so)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { Countdown } from "./Countdown";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Countdown", () => {
  it("counts down to the deadline the server set", () => {
    render(<Countdown deadline={new Date(NOW + 5 * 60_000).toISOString()} />);
    expect(screen.getByText("5:00")).toBeTruthy();

    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByText("3:59")).toBeTruthy();
  });

  it("says the same thing in words to a screen reader", () => {
    render(<Countdown deadline={new Date(NOW + 90_000).toISOString()} />);
    expect(screen.getByText("Price holds for 1 minutes and 30 seconds.")).toBeTruthy();
  });

  it("says plainly that the price is gone, and only once", () => {
    const onExpire = vi.fn();
    render(<Countdown deadline={new Date(NOW - 1_000).toISOString()} onExpire={onExpire} />);

    expect(screen.getByRole("status").textContent).toBe("This price has expired.");
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("treats a deadline it cannot read as expired rather than counting from zero", () => {
    render(<Countdown deadline="not a date" />);
    expect(screen.getByRole("status").textContent).toBe("This price has expired.");
  });
});
