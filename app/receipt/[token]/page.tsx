"use client";

/**
 * The receipt a client or a freelancer keeps.
 * Roadmap: S4.6 · Spec: PRD FR-18
 *
 * Two links land here. The one the app generates carries `?attempt=<id>`, so the read is keyed by the
 * attempt and authorised by the token; a bare `/receipt/<token>` — copied out of the dashboard or
 * trimmed by an email client — carries only the token, and because that token is unique to one
 * attempt it resolves on its own. `useReceipt` picks between them, so neither link dead-ends.
 */

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Receipt } from "@/components/receipt/Receipt";
import { ApiError } from "@/lib/api/client";
import { useReceipt } from "@/lib/api/queries";

export default function Page() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
      {/* The read depends on the query string, so the boundary is what lets this prerender. */}
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading your receipt…</p>}>
        <ReceiptView />
      </Suspense>
    </main>
  );
}

function ReceiptView() {
  const { token } = useParams<{ token: string }>();
  const search = useSearchParams();
  const receipt = useReceipt(search.get("attempt"), token);

  if (receipt.isPending) {
    return <p className="text-sm text-ink-muted">Loading your receipt…</p>;
  }

  if (receipt.isError) {
    return <Failure error={receipt.error} />;
  }

  return <Receipt receipt={receipt.data} />;
}

function Failure({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  const sentence =
    status === 404 || status === 401 || status === 403
      ? "That link does not match a payment on our records. Receipt links are per payment, so a re-quoted invoice gets a new one."
      : status === 0
        ? "The receipt could not be read — the service did not answer. Nothing about the payment changed; try again shortly."
        : "The receipt could not be read.";

  return (
    <Card title="Receipt unavailable">
      <p className="text-sm">{sentence}</p>
      {error instanceof ApiError && status !== 0 ? (
        <p className="mt-2 text-xs text-ink-muted">{error.message}</p>
      ) : null}
      <Link
        href="/"
        className={buttonClass({ variant: "secondary", size: "sm" }) + " mt-4 self-start"}
      >
        Home
      </Link>
    </Card>
  );
}
