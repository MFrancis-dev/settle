"use client";

/**
 * The invoice list, filtered by the state a freelancer acts on.
 * Roadmap: S4.3 · Spec: PRD FR-19
 *
 * "Needs attention" is a group, not a status: a short payment, a payment that arrived after a
 * cancellation, and a failure all need the same action from the person reading the list, so they are
 * listed together rather than three tabs apart.
 */

import { useState } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { InvoiceTable } from "@/components/invoice/InvoiceTable";
import { useInvoices } from "@/lib/api/queries";
import type { InvoiceStatus } from "@/lib/core/status";

type Filter = "all" | "open" | "paid" | "attention";

const FILTERS: { value: Filter; label: string; statuses: InvoiceStatus[] | null }[] = [
  { value: "all", label: "All", statuses: null },
  {
    value: "open",
    label: "Awaiting payment",
    statuses: ["draft", "open", "payment_detected", "processing"],
  },
  { value: "paid", label: "Paid", statuses: ["paid"] },
  {
    value: "attention",
    label: "Needs attention",
    statuses: ["underpaid", "overpaid", "paid_after_cancel", "failed", "refunded"],
  },
];

export default function Page() {
  const [filter, setFilter] = useState<Filter>("all");
  // The list is the freelancer's own and short, so one unfiltered fetch is cached and the tabs are
  // instant — and "needs attention" spans several statuses the API could not ask for at once.
  const invoices = useInvoices();
  const shown = invoices.data?.filter((invoice) => matches(filter, invoice.status));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Link href="/invoices/new" className={buttonClass({})}>
          New invoice
        </Link>
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`rounded-control px-3 py-1.5 text-sm ${
              filter === option.value
                ? "bg-ink text-ink-invert font-medium"
                : "text-ink-muted hover:bg-surface-sunk"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {invoices.isPending ? (
        <p className="text-sm text-ink-muted">Loading invoices…</p>
      ) : invoices.isError ? (
        <ErrorCard
          title="The list could not be loaded"
          error={invoices.error}
          onRetry={() => invoices.refetch()}
        />
      ) : shown && shown.length === 0 ? (
        <Card title="No invoices here yet">
          <p className="text-sm text-ink-muted">
            {filter === "all"
              ? "Your first invoice takes about a minute: who it is for, what you did, the total."
              : "Nothing in this state right now."}
          </p>
          {filter === "all" ? (
            <div className="mt-3">
              <Link href="/invoices/new" className={buttonClass({ variant: "secondary" })}>
                New invoice
              </Link>
            </div>
          ) : null}
        </Card>
      ) : shown ? (
        <Card>
          <InvoiceTable invoices={shown} />
        </Card>
      ) : null}
    </div>
  );
}

/** The API filters by one status at a time, so a group filters in the browser after the fetch. */
function matches(filter: Filter, status: InvoiceStatus): boolean {
  const group = FILTERS.find((option) => option.value === filter)?.statuses;
  return group === null || group === undefined ? true : group.includes(status);
}
