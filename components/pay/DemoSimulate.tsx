"use client";

/**
 * The demo's stand-in for a client's wallet, on the pay page.
 * Roadmap: S6.4 · Spec: PRD FR-22, ARCHITECTURE.md §7
 *
 * Shown instead of the "already sent it?" reference field when the invoice says it is a demo. One press
 * moves the payment one step — deposit seen, conversion running, delivered — because a judge should
 * watch the sequence rather than see a final state appear. The named outcomes cover the paths that are
 * not on the happy one: a short deposit, a refund, a failure, a lapsed quote.
 *
 * The buttons write through `/api/demo/simulate-payment`, which writes the same rows a real poll writes
 * (`recordAttemptStatus` + `storeDerivedInvoiceStatus`). This panel invents no state of its own: it
 * re-reads the invoice and the status poll after every press, so what it shows next is what the app
 * stored, and the deposit address the page is displaying is the one the simulated payment lands on.
 */

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDemoSimulate } from "@/lib/api/queries";
import { ApiError } from "@/lib/api/client";
import type { DemoOutcome } from "@/lib/core/schemas";

const LABELS: Readonly<Record<DemoOutcome, string>> = {
  next: "The client sent it",
  paid: "Delivered in full",
  underpaid: "It arrived short",
  refunded: "Send it back",
  failed: "The swap failed",
  expired: "The quote lapsed",
};

const ORDER: readonly DemoOutcome[] = [
  "next",
  "paid",
  "underpaid",
  "refunded",
  "failed",
  "expired",
];

export function DemoSimulate({ publicId }: { publicId: string }) {
  const simulate = useDemoSimulate();
  /** `null` until the server has said what is left; every outcome is offered before then. */
  const [allowed, setAllowed] = useState<readonly DemoOutcome[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function press(outcome: DemoOutcome) {
    setMessage(null);
    try {
      const result = await simulate.mutateAsync({ publicId, outcome });
      setAllowed(result.next);
      setMessage(
        result.paid
          ? `Simulated: ${result.invoiceStatus.replace(/_/g, " ")}. The receipt is on this page now.`
          : `Simulated: the payment is ${result.attempt.status.replace(/_/g, " ")}, so the invoice reads ${result.invoiceStatus.replace(/_/g, " ")}.`,
      );
    } catch (error) {
      setAllowed(null);
      setMessage(error instanceof ApiError ? error.message : "That step could not be simulated.");
    }
  }

  const offered = allowed === null ? ORDER : ORDER.filter((outcome) => allowed.includes(outcome));

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-sm font-medium">Demo controls: simulate this payment</h3>
      <p className="mt-1 text-xs text-ink-muted">
        No wallet is involved and no money moves. Each press is one step of what the payment service
        would report, written to the same rows a real payment writes.
      </p>

      {offered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          This payment has finished, so there is nothing left to simulate. Get a new payment address
          to run it again.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {offered.map((outcome) => (
            <Button
              key={outcome}
              variant={outcome === "next" ? "primary" : "secondary"}
              size="sm"
              disabled={simulate.isPending}
              pending={simulate.isPending && simulate.variables?.outcome === outcome}
              onClick={() => void press(outcome)}
            >
              {LABELS[outcome]}
            </Button>
          ))}
        </div>
      )}

      {message ? (
        <div className="mt-3">
          <Alert tone="neutral">{message}</Alert>
        </div>
      ) : null}
    </div>
  );
}
