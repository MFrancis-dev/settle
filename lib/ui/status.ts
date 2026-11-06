/**
 * Plain-language labels and colours for every status the UI can be shown.
 * Roadmap: S4.3, S4.5 · Spec: PRD §7 ("no crypto jargon on client pages"), AGENTS.md §6
 *
 * The unions are switched exhaustively, so adding a status to `lib/core/status.ts` fails the build
 * until it is explained here — a status the client cannot read is a support incident.
 */

import type { AttemptStatus, InvoiceStatus } from "@/lib/core/status";

export type Tone = "neutral" | "info" | "success" | "warn" | "danger";

export function invoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "open":
      return "Awaiting payment";
    case "payment_detected":
      return "Payment seen";
    case "processing":
      return "Converting";
    case "paid":
      return "Paid";
    case "underpaid":
      return "Short payment";
    case "overpaid":
      return "Paid twice or over";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "paid_after_cancel":
      return "Paid after you cancelled";
  }
}

/** What the client's own payment did, which is narrower than what happened to the invoice. */
export function attemptStatusLabel(status: AttemptStatus): string {
  switch (status) {
    case "awaiting_deposit":
      return "Waiting for your payment";
    case "payment_detected":
      return "Payment received, checking it";
    case "processing":
      return "Converting to the invoiced amount";
    case "success":
      return "Delivered";
    case "underpaid":
      return "Not enough arrived";
    case "refunded":
      return "Refunded to you";
    case "failed":
      return "Could not be completed";
    case "expired":
      return "Address expired";
  }
}

export function invoiceStatusTone(status: InvoiceStatus): Tone {
  switch (status) {
    case "paid":
      return "success";
    case "underpaid":
    case "overpaid":
    case "paid_after_cancel":
      return "warn";
    case "failed":
    case "refunded":
      return "danger";
    case "cancelled":
      return "neutral";
    case "payment_detected":
    case "processing":
      return "info";
    case "draft":
    case "open":
      return "neutral";
  }
}

export function attemptStatusTone(status: AttemptStatus): Tone {
  switch (status) {
    case "success":
      return "success";
    case "underpaid":
    case "expired":
      return "warn";
    case "failed":
    case "refunded":
      return "danger";
    case "payment_detected":
    case "processing":
      return "info";
    case "awaiting_deposit":
      return "neutral";
  }
}

/**
 * Whether the "Cancel invoice" control may be offered.
 *
 * Mirrors the server's rule (`lib/server/invoices.ts`): settled money is a record, not a draft. The
 * UI hides the control rather than letting a person press a button that will always answer 409.
 */
export function canCancel(status: InvoiceStatus): boolean {
  switch (status) {
    case "paid":
    case "overpaid":
    case "paid_after_cancel":
    case "cancelled":
      return false;
    default:
      return true;
  }
}

/**
 * One sentence for the client, in the language of money rather than of chains. `underpaid` says what
 * to do about it, because that is the state where the client still has a choice.
 */
export function clientMessage(input: {
  status: InvoiceStatus;
  pollReason: "no_attempt" | "upstream_not_found" | "upstream_unreachable" | null;
}): string {
  if (input.status === "underpaid") {
    return "Less arrived than the invoice asked for. Send the difference — the exact amount is below — to this same address, or wait and the shortfall comes back to your refund address.";
  }
  if (input.status === "overpaid") {
    return "More than one payment reached this invoice, so the extra is on its way back to the refund address you gave.";
  }
  if (input.status === "paid_after_cancel") {
    return "This invoice was cancelled, but a payment still arrived. It is kept as paid, and the freelancer sees it here.";
  }
  if (input.status === "refunded") {
    return "The payment was sent back to the refund address you gave. The invoice is open again if you want to try once more.";
  }
  if (input.status === "cancelled") {
    return "This invoice was cancelled by the person who sent it.";
  }
  if (input.status === "failed") {
    return "The payment could not be completed. Nothing was delivered, and your funds stay where they were.";
  }
  if (input.pollReason === "upstream_unreachable") {
    return "We cannot reach the exchange right now, so this status may be a few minutes old. Keep the page open.";
  }
  if (input.status === "paid") {
    return "The full invoiced amount has arrived. A receipt is ready below.";
  }
  return "";
}
