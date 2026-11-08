"use client";

/**
 * The demo's control room: the story, the buttons that move a payment, and the order to show it in.
 * Roadmap: S6.3, S6.4 · Spec: PRD FR-22..FR-24, PRD §8, ARCHITECTURE.md §7
 *
 * Opening this page starts the session: `GET /api/demo/session` seeds the fictional freelancer the
 * first time it is asked and sets her session cookie, so the dashboard behind the links below is the
 * real dashboard, signed in as a demo account, with no wallet involved.
 *
 * Nothing on this page is a parallel implementation. The invoices are read back from the database, and
 * every button writes through the API the product uses — a simulated step lands in the same rows a real
 * poll writes, which is why the pay page and the receipt agree with what is listed here.
 */

import Link from "next/link";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, DefinitionList } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/invoice/StatusBadge";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { ApiError } from "@/lib/api/client";
import { useDemoReset, useDemoSession, useDemoSimulate } from "@/lib/api/queries";
import type { DemoInvoiceSummary } from "@/lib/api/types";
import type { DemoOutcome } from "@/lib/core/schemas";

/** PRD §8: the five steps the video and a judge's own click-through follow, in order. */
const SCRIPT: readonly { step: string; href: string; see: string }[] = [
  {
    step: "Create an invoice",
    href: "/invoices/new",
    see: "Line items total exactly, in base units, with no floating point anywhere.",
  },
  {
    step: "Choose where the money goes",
    href: "/settings",
    see: "A payout address is validated per chain, signed by the wallet, and keeps its history.",
  },
  {
    step: "Send the client their link",
    href: "/invoices",
    see: "One unguessable pay link per invoice; the client never needs an account.",
  },
  {
    step: "The client pays",
    href: "#invoices",
    see: "A dry-run price first, then one live deposit address, then the statuses arriving in order.",
  },
  {
    step: "Read the receipt",
    href: "#invoices",
    see: "Both transaction hashes, the fee, and the quote signature — the accountant's paper trail.",
  },
];

const OUTCOME_LABELS: Readonly<Record<DemoOutcome, string>> = {
  next: "Next step",
  paid: "Delivered in full",
  underpaid: "Arrived short",
  refunded: "Refunded",
  failed: "Failed",
  expired: "Quote lapsed",
};

const OUTCOME_ORDER: readonly DemoOutcome[] = [
  "next",
  "paid",
  "underpaid",
  "refunded",
  "failed",
  "expired",
];

export default function Page() {
  const session = useDemoSession();
  const reset = useDemoReset();
  const simulate = useDemoSimulate();
  const [message, setMessage] = useState<string | null>(null);

  async function press(publicId: string, outcome: DemoOutcome) {
    setMessage(null);
    try {
      const result = await simulate.mutateAsync({ publicId, outcome });
      setMessage(
        `${result.invoiceStatus.replace(/_/g, " ")} — the attempt is ${result.attempt.status.replace(
          /_/g,
          " ",
        )}${result.receiptUrl ? ", and the receipt is ready" : ""}.`,
      );
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That step could not be simulated.");
    }
  }

  if (session.isPending) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-ink-muted">Starting the demo…</p>
      </main>
    );
  }

  if (session.isError || !session.data) {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <Alert tone="danger" title="This server is not running the demo">
          <p>{session.error instanceof Error ? session.error.message : "Unknown error."}</p>
          <p className="mt-2 text-ink-muted">
            Stop the app and start it with <code className="font-mono">pnpm demo</code>. Demo mode
            is refused next to a real database or a public URL, so it cannot be turned on by
            accident here.
          </p>
        </Alert>
      </main>
    );
  }

  const view = session.data;

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-8 pb-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settle demo</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {view.seeded
            ? "The fictional freelancer was written to this database a moment ago."
            : "The fictional freelancer is already in this database."}
        </p>
      </header>

      <DemoBanner />

      <Card title="The account you are signed in as">
        <DefinitionList
          items={[
            { label: "NEAR account", value: view.account.nearAccountId },
            { label: "Name", value: view.account.displayName },
            { label: "Paid out to", value: view.account.payoutAddress },
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/dashboard" className={buttonClass({ variant: "primary", size: "sm" })}>
            Open her dashboard
          </Link>
          <Link href="/invoices" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Her invoices
          </Link>
          <Link href="/settings" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Her payout settings
          </Link>
          <Button
            variant="secondary"
            size="sm"
            pending={reset.isPending}
            onClick={async () => {
              setMessage(null);
              await reset.mutateAsync();
              setMessage(
                "The story was reset: ten invoices, one per status, and no payments in flight.",
              );
            }}
          >
            Restart the story
          </Button>
        </div>
      </Card>

      <Card title="What to show, in order">
        <ol className="flex flex-col gap-3 text-sm">
          {SCRIPT.map((item, index) => (
            <li key={item.step} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunk text-xs font-medium">
                {index + 1}
              </span>
              <span>
                {item.href.startsWith("#") ? (
                  <a href={item.href} className="font-medium underline underline-offset-4">
                    {item.step}
                  </a>
                ) : (
                  <Link href={item.href} className="font-medium underline underline-offset-4">
                    {item.step}
                  </Link>
                )}
                <span className="block text-ink-muted">{item.see}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <section id="invoices" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Ten invoices, one per status</h2>
        <p className="text-sm text-ink-muted">
          Open a pay link to see the client&rsquo;s side. Where a payment is still moving, the
          buttons underneath it are the ones that move it.
        </p>

        {message ? <Alert tone="neutral">{message}</Alert> : null}

        {view.invoices.map((invoice) => (
          <DemoInvoice
            key={invoice.publicId}
            invoice={invoice}
            busy={simulate.isPending}
            onSimulate={(outcome) => void press(invoice.publicId, outcome)}
          />
        ))}
      </section>
    </main>
  );
}

function DemoInvoice({
  invoice,
  busy,
  onSimulate,
}: {
  invoice: DemoInvoiceSummary;
  busy: boolean;
  onSimulate(outcome: DemoOutcome): void;
}) {
  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{invoice.clientName}</p>
          <p className="text-xs text-ink-muted">
            {invoice.number}
            {invoice.activeAttempt
              ? ` · paying in ${invoice.activeAttempt.originAsset.symbol ?? "…"}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">{invoice.total ? <Money money={invoice.total} /> : "—"}</span>
          <StatusBadge status={invoice.status} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/pay/${invoice.publicId}`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          Open the pay page
        </Link>
        {invoice.receiptUrl ? (
          <Link
            href={invoice.receiptUrl}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Read the receipt
          </Link>
        ) : null}

        {invoice.activeAttempt ? (
          <span className="flex flex-wrap items-center gap-2 border-l border-line pl-3">
            <span className="text-xs text-ink-muted">Simulate:</span>
            {OUTCOME_ORDER.map((outcome) => (
              <Button
                key={outcome}
                variant={outcome === "next" ? "primary" : "secondary"}
                size="sm"
                disabled={busy}
                pending={busy && outcome === "next"}
                onClick={() => onSimulate(outcome)}
              >
                {OUTCOME_LABELS[outcome]}
              </Button>
            ))}
          </span>
        ) : invoice.finishedPayments > 0 ? (
          <span className="text-xs text-ink-faint">
            Every payment on this invoice has finished.
          </span>
        ) : (
          // A draft or an unpaid invoice has nothing in flight either, and must not claim otherwise.
          <span className="text-xs text-ink-faint">
            No payment has been started on this invoice yet.
          </span>
        )}
      </div>
    </article>
  );
}
