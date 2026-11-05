"use client";

/**
 * The receipt a client or a freelancer keeps.
 * Roadmap: S4.6 · Spec: PRD FR-18
 *
 * `GET /api/receipts/:attemptId` needs the attempt id as well as the token, so the link the status
 * route hands out carries `?attempt=`. A token on its own cannot be resolved — the API has no way to
 * look one up — so this page says that plainly instead of guessing at an invoice.
 */

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Alert } from "@/components/ui/alert";
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
  const attemptId = search.get("attempt");
  const receipt = useReceipt(attemptId, token);

  if (attemptId === null || attemptId === "") {
    return (
      <Alert
        tone="warn"
        title="This receipt link is missing its payment reference"
        actions={
          <Link href="/" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Home
          </Link>
        }
      >
        <p>
          A receipt link carries a payment reference after the <span className="font-mono">?</span>. A
          link that was cut short — by an email client, a chat app, or a copy that stopped at the end of
          a line — arrives without it, and the reference cannot be guessed. The Receipt button on the
          payment page always includes it.
        </p>
      </Alert>
    );
  }

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
      ? "That reference and token pair does not match a payment on our records. Receipt links are per payment, so a re-quoted invoice gets a new one."
      : status === 0
        ? "The receipt could not be read — the service did not answer. Nothing about the payment changed; try again shortly."
        : "The receipt could not be read.";

  return (
    <Card title="Receipt unavailable">
      <p className="text-sm">{sentence}</p>
      {error instanceof ApiError && status !== 0 ? (
        <p className="mt-2 text-xs text-ink-muted">{error.message}</p>
      ) : null}
    </Card>
  );
}
