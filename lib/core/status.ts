/**
 * Status unions, 1Click → our status mapping, terminal states.
 * Roadmap: S1.3 · Spec: ARCHITECTURE.md §3.3
 * Status: scaffold — not implemented yet.
 */

/** 1Click /v0/status values. 🔍 Verify the exact enum (S0.12). */
export const ONECLICK_STATUSES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "SUCCESS",
  "INCOMPLETE_DEPOSIT",
  "REFUNDED",
  "FAILED",
] as const;
export type OneClickStatus = (typeof ONECLICK_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  "awaiting_deposit",
  "payment_detected",
  "processing",
  "success",
  "underpaid",
  "refunded",
  "failed",
  "expired",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const INVOICE_STATUSES = [
  "draft",
  "open",
  "payment_detected",
  "processing",
  "paid",
  "underpaid",
  "overpaid",
  "refunded",
  "failed",
  "cancelled",
  "paid_after_cancel",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<AttemptStatus> = new Set([
  "success",
  "refunded",
  "failed",
  "expired",
]);

export function attemptStatusFromOneClick(s: OneClickStatus): AttemptStatus {
  switch (s) {
    case "PENDING_DEPOSIT":
      return "awaiting_deposit";
    case "KNOWN_DEPOSIT_TX":
      return "payment_detected";
    case "PROCESSING":
      return "processing";
    case "SUCCESS":
      return "success";
    case "INCOMPLETE_DEPOSIT":
      return "underpaid";
    case "REFUNDED":
      return "refunded";
    case "FAILED":
      return "failed";
  }
}

/** TODO(S1.3): monotonic transition check — an attempt never moves backwards. */
export function canTransition(_from: AttemptStatus, _to: AttemptStatus): boolean {
  throw new Error("Not implemented (S1.3)");
}

/** TODO(S1.3): derive invoice status from its attempts (overpaid, paid_after_cancel, …). */
export function deriveInvoiceStatus(_input: {
  current: InvoiceStatus;
  cancelled: boolean;
  attempts: AttemptStatus[];
}): InvoiceStatus {
  throw new Error("Not implemented (S1.3)");
}
