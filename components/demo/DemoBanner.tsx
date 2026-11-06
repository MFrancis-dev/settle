import Link from "next/link";

import { Alert } from "@/components/ui/alert";

/**
 * The line that says none of this is real.
 * Roadmap: S6.3 · Spec: ARCHITECTURE.md §7 · PRD FR-22
 *
 * One component, shown on every screen a demo can reach — the signed-in shell, `/demo` and the pay
 * page — because a simulated payment that looks like a real one is the single worst thing this app
 * could show somebody. The pay page has no session, so it cannot ask `/api/me` whether this is a demo;
 * it reads the `demo` flag on the invoice it was given instead.
 */
export function DemoBanner() {
  return (
    <Alert
      tone="warn"
      title="Demo mode — nothing on this page moves money"
      actions={
        <Link href="/demo" className="text-sm font-medium underline underline-offset-4">
          Open the demo controls
        </Link>
      }
    >
      <p>
        This is a fictional freelancer&rsquo;s data. The invoices, the payments and the receipts were
        written in this process, the payment service answers from a recording, and no wallet is ever
        asked to sign anything.
      </p>
    </Alert>
  );
}
