// @vitest-environment jsdom
/**
 * The one rule an amount on screen has to obey: exact, or honestly labelled as unresolved.
 * Roadmap: S4.8 · Spec: AGENTS.md §6 (never a float for money), PRD FR-14
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { MoneyView } from "@/lib/api/types";
import { parseBaseUnits } from "@/lib/core/money";
import { UNRESOLVED_ASSET } from "@/lib/ui/money-text";

import { Money, MoneyExact } from "./money";

afterEach(cleanup);

const known: MoneyView = {
  assetId: "usdc.near",
  baseUnits: parseBaseUnits("1234500000"),
  amount: "1234.5",
  symbol: "USDC",
  decimals: 6,
};

const unresolved: MoneyView = {
  assetId: "some-other-token",
  baseUnits: parseBaseUnits("1234500000"),
  amount: null,
  symbol: null,
  decimals: null,
};

describe("Money", () => {
  it("shows the token amount next to its symbol", () => {
    render(<Money money={known} />);
    expect(screen.getByText("1,234.5")).toBeTruthy();
    expect(screen.getByText("USDC")).toBeTruthy();
  });

  it("shows the exact base units and says why when the token list did not answer", () => {
    render(<Money money={unresolved} />);
    expect(screen.getByText("1,234,500,000")).toBeTruthy();
    expect(screen.getByText(UNRESOLVED_ASSET)).toBeTruthy();
    expect(screen.queryByText("USDC")).toBeNull();
  });

  it("cuts a long fraction rather than rounding it up", () => {
    render(<Money money={{ ...known, amount: "1234.56789" }} places={2} />);
    expect(screen.getByText("1,234.56…")).toBeTruthy();
  });

  it("does not invent decimals for an unresolved token, whatever it is asked to show", () => {
    render(<Money money={unresolved} places={2} />);
    expect(screen.getByText("1,234,500,000")).toBeTruthy();
    expect(screen.getByText(UNRESOLVED_ASSET)).toBeTruthy();
  });
});

describe("MoneyExact", () => {
  it("gives the figure a block explorer can be checked against", () => {
    render(<MoneyExact money={known} />);
    expect(screen.getByText("1234500000")).toBeTruthy();
    expect(screen.getByText(/6 decimals/)).toBeTruthy();
  });

  it("leaves the decimals out when they are unknown instead of guessing", () => {
    render(<MoneyExact money={unresolved} />);
    expect(screen.getByText("1234500000")).toBeTruthy();
    expect(screen.queryByText(/decimals/)).toBeNull();
  });
});
