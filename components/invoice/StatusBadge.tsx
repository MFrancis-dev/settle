import { Badge } from "@/components/ui/badge";
import { attemptStatusLabel, attemptStatusTone, invoiceStatusLabel, invoiceStatusTone } from "@/lib/ui/status";
import type { AttemptStatus, InvoiceStatus } from "@/lib/core/status";

/**
 * The two status pills the app draws: one for the invoice, one for a single payment attempt.
 * Roadmap: S4.3 · Spec: PRD §7 (plain money words), FR-19
 *
 * The words come from `lib/ui/status.ts`, which switches the unions exhaustively — a new status in
 * the core fails the build here instead of appearing on screen as a blank pill.
 */

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={invoiceStatusTone(status)}>{invoiceStatusLabel(status)}</Badge>;
}

export function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  return <Badge tone={attemptStatusTone(status)}>{attemptStatusLabel(status)}</Badge>;
}
