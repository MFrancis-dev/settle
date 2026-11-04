/**
 * Status unions, 1Click → our status mapping, terminal states.
 * Roadmap: S1.3 · Spec: ARCHITECTURE.md §3.3
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

/**
 * Where a deposit is up to, strongest signal first. `underpaid` outranks `processing`
 * because it is a verdict the client needs acting on, not an in-flight state.
 */
const ATTEMPT_SIGNAL: Record<AttemptStatus, number> = {
  awaiting_deposit: 0,
  expired: 0,
  refunded: 0,
  failed: 0,
  payment_detected: 2,
  processing: 3,
  underpaid: 4,
  success: 5,
};

/**
 * Forward-only moves for one attempt. Terminal states have no successors, so a late or
 * out-of-order poll cannot resurrect one. `expired` is reachable only from
 * `awaiting_deposit` because the rule behind it is "deadline passed and *no* deposit".
 */
const ALLOWED_NEXT: Record<AttemptStatus, readonly AttemptStatus[]> = {
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

/**
 * Whether an attempt may move `from` → `to`. Identical statuses return false: the caller has
 * nothing to write, and treating a no-op poll as an illegal move would flood the logs.
 */
export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  if (from === to) return false;
  return ALLOWED_NEXT[from].includes(to);
}

/** An invoice that has settled must not be walked back by a stale attempt read. */
const SETTLED_INVOICE_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  "paid",
  "overpaid",
  "paid_after_cancel",
]);

/**
 * Invoice status from its attempts, following ARCHITECTURE.md §3.3:
 * two successes is an overpayment, one success pays the invoice (or lands after a cancel),
 * `refunded`/`failed`/`expired` return it to `open` so the client can retry, and a `draft`
 * with no attempts stays `draft`.
 */
export function deriveInvoiceStatus(input: {
  current: InvoiceStatus;
  cancelled: boolean;
  attempts: AttemptStatus[];
}): InvoiceStatus {
  const { current, cancelled, attempts } = input;
  const successes = attempts.filter((status) => status === "success").length;
  if (successes >= 2) return "overpaid";
  if (successes === 1) return cancelled ? "paid_after_cancel" : "paid";

  // No completed payment in this read: keep a settled invoice settled rather than un-paying it.
  if (SETTLED_INVOICE_STATUSES.has(current)) return current;

  const strongest = attempts.reduce<AttemptStatus>(
    (best, status) => (ATTEMPT_SIGNAL[status] > ATTEMPT_SIGNAL[best] ? status : best),
    "awaiting_deposit",
  );
  if (strongest === "processing") return "processing";
  if (strongest === "payment_detected") return "payment_detected";
  if (strongest === "underpaid") return "underpaid";
  if (cancelled) return "cancelled";
  if (attempts.length === 0 && current === "draft") return "draft";
  return "open";
}
