// @vitest-environment jsdom
/**
 * The client's live payment block: the numbers behind a short payment, the refund line, and the
 * other payment on an invoice that was paid twice.
 * Roadmap: S7.1, S7.2 · Spec: PRD FR-17, ARCHITECTURE.md §11 (short payment, overpayment)
 *
 * The sentences themselves are covered by `lib/ui/status.test.ts`; what is tested here is that the
 * screen renders the *amounts*, because "send the difference" is not something a person can act on
 * until the difference is stated.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { AttemptView, MoneyView, StatusView } from "@/lib/api/types";
import { parseBaseUnits } from "@/lib/core/money";

import { PayStatus } from "./PayStatus";

const WNEAR = { assetId: "nep141:wrap.near", symbol: "wNEAR", decimals: 24 };
const USDC = { assetId: "usdc.near", symbol: "USDC", decimals: 6 };

function near(baseUnits: string, amount: string): MoneyView {
  return { ...WNEAR, baseUnits: parseBaseUnits(baseUnits), amount };
}

function usdc(baseUnits: string, amount: string): MoneyView {
  return { ...USDC, baseUnits: parseBaseUnits(baseUnits), amount };
}

function attempt(overrides: Partial<AttemptView> = {}): AttemptView {
  return {
    id: "attempt-1",
    invoiceId: "invoice-1",
    status: "awaiting_deposit",
    oneclickStatus: null,
    originAsset: near("2700000000000000000000000", "2.7"),
    payoutAsset: usdc("10000000", "10"),
    depositAddress: "settle-deposit-0001",
    depositMemo: null,
    feeUsd: "0.01",
    quoteDeadline: "2026-11-06T12:30:00.000Z",
    depositTxHash: null,
    deliveryTxHash: null,
    deposited: null,
    refunded: null,
    refundReason: null,
    shortfall: null,
    createdAt: "2026-11-06T12:00:00.000Z",
    updatedAt: "2026-11-06T12:00:00.000Z",
    receiptUrl: null,
    ...overrides,
  };
}

function view(overrides: Partial<StatusView> = {}): StatusView {
  return {
    invoiceStatus: "open",
    attempt: attempt(),
    otherPayments: [],
    polled: true,
    pollReason: null,
    paid: false,
    receiptUrl: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("PayStatus", () => {
  it("states what arrived and what is still owed, in numbers (S7.1)", () => {
    const { container } = render(
      <PayStatus
        status={view({
          invoiceStatus: "underpaid",
          attempt: attempt({
            status: "underpaid",
            deposited: near("1350000000000000000000000", "1.35"),
            shortfall: near("1350000000000000000000000", "1.35"),
          }),
        })}
      />,
    );

    expect(screen.getByText("Arrived")).toBeTruthy();
    expect(screen.getByText("Still owed")).toBeTruthy();
    expect(container.textContent).toContain("1.35");
    expect(container.textContent).toContain("Send the difference");
  });

  // 1Click measures a deposit as the running total on one address: a top-up completes the payment,
  // and a total still short at the deadline is refunded whole. The client is told both, or the
  // first sentence sends them to a wallet with the wrong expectation (S0.12, docs + live 2026-11-09).
  it("tells a short payer that deposits add up, and what the deadline does", () => {
    const { container } = render(
      <PayStatus
        status={view({
          invoiceStatus: "underpaid",
          attempt: attempt({
            status: "underpaid",
            deposited: near("1350000000000000000000000", "1.35"),
            shortfall: near("1350000000000000000000000", "1.35"),
          }),
        })}
      />,
    );

    const message = container.textContent ?? "";
    expect(message).toContain("deposits add up");
    expect(message).toContain("before the quote expires");
    expect(message).toContain("everything you sent comes back");
    expect(message).not.toContain("the shortfall comes back");
  });

  it("shows no shortfall row once the full amount has landed", () => {
    render(
      <PayStatus
        status={view({
          invoiceStatus: "paid",
          paid: true,
          attempt: attempt({
            status: "success",
            deposited: near("2700000000000000000000000", "2.7"),
          }),
        })}
      />,
    );

    expect(screen.getByText("Arrived")).toBeTruthy();
    expect(screen.queryByText("Still owed")).toBeNull();
  });

  it("names the refund and the reason the exchange gave for it", () => {
    const { container } = render(
      <PayStatus
        status={view({
          invoiceStatus: "refunded",
          attempt: attempt({
            status: "refunded",
            refunded: near("2700000000000000000000000", "2.7"),
            refundReason: "DEPOSIT_TOO_SMALL",
          }),
        })}
      />,
    );

    expect(screen.getByText("Sent back to you")).toBeTruthy();
    expect(container.textContent).toContain("DEPOSIT_TOO_SMALL");
  });

  it("reports the other payment on an invoice paid twice, without its address (S7.2)", () => {
    const { container } = render(
      <PayStatus
        status={view({
          invoiceStatus: "overpaid",
          paid: true,
          attempt: attempt({
            status: "success",
            deposited: near("2700000000000000000000000", "2.7"),
          }),
          otherPayments: [
            {
              status: "success",
              deposited: near("2700000000000000000000000", "2.7"),
              refunded: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("One other payment reached this invoice")).toBeTruthy();
    expect(container.textContent).not.toContain("settle-deposit-0001");
  });

  it("says when the status could not be refreshed, rather than showing a stale one as fresh", () => {
    render(<PayStatus status={view({ polled: false, pollReason: "upstream_unreachable" })} />);

    expect(screen.getByText("Status could not be refreshed just now")).toBeTruthy();
    expect(screen.getByText(/cannot reach the exchange right now/i)).toBeTruthy();
  });
});
