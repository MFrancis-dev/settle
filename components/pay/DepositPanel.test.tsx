// @vitest-environment jsdom
/**
 * The deposit panel: the exact amount, the address, the memo warning and the clock.
 * Roadmap: S4.8 · Spec: PRD FR-14, FR-15, FR-16
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { MoneyView } from "@/lib/api/types";
import { parseBaseUnits } from "@/lib/core/money";

import { DepositPanel } from "./DepositPanel";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const deposit: MoneyView = {
  assetId: "usdc.near",
  baseUnits: parseBaseUnits("1000000"),
  amount: "1.0",
  symbol: "USDC",
  decimals: 6,
};

function panel(overrides: Partial<Parameters<typeof DepositPanel>[0]> = {}) {
  return render(
    <DepositPanel
      deposit={deposit}
      feeUsd="0.85"
      timeEstimateS={120}
      deadline={new Date(NOW + 10 * 60_000).toISOString()}
      address="deposit-address-abc123"
      memo={null}
      reused={false}
      onExpire={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DepositPanel", () => {
  it("shows the amount, the exact base units and the address", () => {
    panel();
    expect(screen.getByText("1.0")).toBeTruthy();
    expect(screen.getByText("1000000")).toBeTruthy();
    expect(screen.getByText("deposit-address-abc123")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
  });

  it("says how long the price holds, and what the conversion costs", () => {
    panel();
    expect(screen.getByText("10:00")).toBeTruthy();
    expect(screen.getByText("$0.85")).toBeTruthy();
    expect(screen.getByText("About 2 min")).toBeTruthy();
  });

  it("warns about the memo only when the network needs one", () => {
    const { unmount } = panel();
    expect(screen.queryByText(/must include this memo/)).toBeNull();
    unmount();

    panel({ memo: "memo-42" });
    expect(screen.getByText("memo-42")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy memo" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("must include this memo");
  });

  it("tells the client when this is the same address as before", () => {
    panel({ reused: true });
    expect(screen.getByText(/same address as before/)).toBeTruthy();
  });

  it("says the price is gone instead of leaving a dead address under a running clock", () => {
    const onExpire = vi.fn();
    panel({ deadline: new Date(NOW - 1_000).toISOString(), onExpire });
    expect(screen.getByRole("status").textContent).toBe("This price has expired.");
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
