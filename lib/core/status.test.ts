import { describe, expect, it } from "vitest";

// Roadmap: S1.3
import {
  ATTEMPT_STATUSES,
  INVOICE_STATUSES,
  ONECLICK_STATUSES,
  TERMINAL_ATTEMPT_STATUSES,
  attemptStatusFromOneClick,
  canTransition,
  deriveInvoiceStatus,
} from "./status";
import type { AttemptStatus, InvoiceStatus, OneClickStatus } from "./status";

describe("status: 1Click → attempt", () => {
  const EXPECTED: Record<OneClickStatus, AttemptStatus> = {
    PENDING_DEPOSIT: "awaiting_deposit",
    KNOWN_DEPOSIT_TX: "payment_detected",
    PROCESSING: "processing",
    SUCCESS: "success",
    INCOMPLETE_DEPOSIT: "underpaid",
    REFUNDED: "refunded",
    FAILED: "failed",
  };

  it("maps every 1Click status exactly once", () => {
    expect(ONECLICK_STATUSES).toHaveLength(Object.keys(EXPECTED).length);
    for (const status of ONECLICK_STATUSES) {
      expect(attemptStatusFromOneClick(status), status).toBe(EXPECTED[status]);
    }
  });

  it("maps onto statuses the attempt union actually has", () => {
    for (const status of ONECLICK_STATUSES) {
      expect(ATTEMPT_STATUSES).toContain(attemptStatusFromOneClick(status));
    }
  });

  it("declares its terminal states", () => {
    expect([...TERMINAL_ATTEMPT_STATUSES].sort()).toEqual(
      ["expired", "failed", "refunded", "success"].sort(),
    );
  });
});

describe("status: canTransition", () => {
  /** The whole machine, spelled out: anything absent here is refused. */
  const FORWARD: Record<AttemptStatus, AttemptStatus[]> = {
    awaiting_deposit: [
      "payment_detected",
      "processing",
      "success",
      "underpaid",
      "refunded",
      "failed",
      "expired",
    ],
    payment_detected: ["processing", "success", "underpaid", "refunded", "failed"],
    processing: ["success", "underpaid", "refunded", "failed"],
    underpaid: ["success", "refunded", "failed"],
    success: [],
    refunded: [],
    failed: [],
    expired: [],
  };

  it("allows exactly the forward moves and nothing else", () => {
    const allowed = new Set(
      ATTEMPT_STATUSES.flatMap((from) => FORWARD[from].map((to) => `${from}->${to}`)),
    );
    for (const from of ATTEMPT_STATUSES) {
      for (const to of ATTEMPT_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed.has(`${from}->${to}`));
      }
    }
  });

  it("never moves an attempt backwards", () => {
    expect(canTransition("processing", "payment_detected")).toBe(false);
    expect(canTransition("payment_detected", "awaiting_deposit")).toBe(false);
    expect(canTransition("success", "processing")).toBe(false);
    expect(canTransition("expired", "payment_detected")).toBe(false);
    expect(canTransition("underpaid", "payment_detected")).toBe(false);
  });

  it("treats terminal states as absorbing", () => {
    for (const terminal of TERMINAL_ATTEMPT_STATUSES) {
      for (const to of ATTEMPT_STATUSES) {
        expect(canTransition(terminal, to), `${terminal} -> ${to}`).toBe(false);
      }
    }
  });

  it("reports a no-op poll as not a transition", () => {
    for (const status of ATTEMPT_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("does not expire an attempt once a deposit is known", () => {
    expect(canTransition("awaiting_deposit", "expired")).toBe(true);
    expect(canTransition("payment_detected", "expired")).toBe(false);
    expect(canTransition("processing", "expired")).toBe(false);
  });
});

describe("status: deriveInvoiceStatus", () => {
  const derive = (
    attempts: AttemptStatus[],
    overrides: { current?: InvoiceStatus; cancelled?: boolean } = {},
  ) =>
    deriveInvoiceStatus({
      current: overrides.current ?? "open",
      cancelled: overrides.cancelled ?? false,
      attempts,
    });

  it("pays an invoice with one successful attempt", () => {
    expect(derive(["success"])).toBe("paid");
    expect(derive(["awaiting_deposit", "success"])).toBe("paid");
  });

  it("derives overpaid from a second success", () => {
    expect(derive(["success", "success"])).toBe("overpaid");
    expect(derive(["failed", "success", "success"])).toBe("overpaid");
  });

  it("derives paid_after_cancel when the invoice was cancelled first", () => {
    expect(derive(["success"], { cancelled: true })).toBe("paid_after_cancel");
    expect(derive(["awaiting_deposit", "success"], { cancelled: true })).toBe("paid_after_cancel");
  });

  it("follows the strongest live attempt", () => {
    expect(derive(["processing"])).toBe("processing");
    expect(derive(["awaiting_deposit", "payment_detected"])).toBe("payment_detected");
    expect(derive(["payment_detected", "processing"])).toBe("processing");
    expect(derive(["awaiting_deposit"])).toBe("open");
  });

  it("surfaces an underpayment ahead of an in-flight attempt", () => {
    expect(derive(["underpaid"])).toBe("underpaid");
    expect(derive(["processing", "underpaid"])).toBe("underpaid");
  });

  it("returns a refunded, failed or expired attempt to open so the client can retry", () => {
    expect(derive(["refunded"])).toBe("open");
    expect(derive(["failed"])).toBe("open");
    expect(derive(["expired"])).toBe("open");
  });

  it("keeps a refunded or failed attempt from masking a payment that did land", () => {
    expect(derive(["success", "refunded", "failed", "expired"])).toBe("paid");
  });

  it("respects a cancellation when no money is moving", () => {
    expect(derive([], { cancelled: true })).toBe("cancelled");
    expect(derive(["awaiting_deposit"], { cancelled: true })).toBe("cancelled");
    expect(derive(["expired"], { cancelled: true })).toBe("cancelled");
  });

  it("keeps a draft with no attempts a draft", () => {
    expect(derive([], { current: "draft" })).toBe("draft");
    expect(derive(["awaiting_deposit"], { current: "draft" })).toBe("open");
  });

  it("never un-pays an invoice whose read shows no success", () => {
    expect(derive([], { current: "paid" })).toBe("paid");
    expect(derive(["refunded"], { current: "overpaid" })).toBe("overpaid");
    expect(derive([], { current: "paid_after_cancel", cancelled: true })).toBe("paid_after_cancel");
  });

  it("reaches exactly the statuses the derivation is meant to name", () => {
    const produced = new Set<InvoiceStatus>([
      derive(["success"]),
      derive(["success", "success"]),
      derive(["success"], { cancelled: true }),
      derive(["processing"]),
      derive(["payment_detected"]),
      derive(["underpaid"]),
      derive(["refunded"]),
      derive(["failed"]),
      derive([], { cancelled: true }),
      derive([], { current: "draft" }),
      derive(["awaiting_deposit"]),
    ]);
    const expected: InvoiceStatus[] = [
      "paid",
      "overpaid",
      "paid_after_cancel",
      "processing",
      "payment_detected",
      "underpaid",
      "open",
      "cancelled",
      "draft",
    ];
    expect([...produced].sort()).toEqual([...expected].sort());
    // §3.3 sends `refunded` and `failed` back to `open`, so those two invoice statuses are
    // never derived — they exist for a manual write, and an attempt reaches them directly.
    for (const status of expected) expect(INVOICE_STATUSES).toContain(status);
    expect(INVOICE_STATUSES.filter((s) => !expected.includes(s))).toEqual(["refunded", "failed"]);
  });
});
