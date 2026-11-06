"use client";

/**
 * The "send exactly this" warning.
 * Roadmap: S4.4 · Spec: PRD FR-16, FR-14
 *
 * A quote is a fixed output: the seller's amount is the number that does not move, so the client's
 * side has to be exact. Both mistakes are still avoidable at this moment, which is why the warning is
 * on the deposit screen rather than only in the status that follows a wrong payment.
 */

import { Alert } from "@/components/ui/alert";
import { Money } from "@/components/ui/money";
import type { MoneyView } from "@/lib/api/types";

export function ShortPaymentWarning({ deposit }: { deposit: MoneyView }) {
  return (
    <Alert tone="info" title="Send this amount in one payment">
      <p>
        Send <Money money={deposit} /> in a single payment, from your own wallet.
      </p>
      <p>
        If less arrives, the conversion cannot complete and the payment is held, then returned to
        the refund address you gave. If more arrives, the extra comes back to that address too.
      </p>
    </Alert>
  );
}
