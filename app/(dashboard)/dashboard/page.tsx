"use client";

/**
 * The freelancer's own summary: what is still owed, what needs a decision, what just moved.
 * Roadmap: S4.7 · Spec: PRD FR-7, FR-19
 *
 * Every figure here is a sum of stored invoice totals, so the screen is checkable against the invoice
 * list. Amounts are grouped by token — two invoices priced in different assets are never added
 * together, and an invoice whose token could not be resolved is counted, not silently dropped.
 */

import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { ErrorCard } from "@/components/ui/error-card";
import { StatusBadge } from "@/components/invoice/StatusBadge";
import { EXPORT_CSV_PATH } from "@/lib/api/client";
import { useInvoices } from "@/lib/api/queries";
import type { InvoiceView, MoneyView } from "@/lib/api/types";
import type { InvoiceStatus } from "@/lib/core/status";
import type { BaseUnits } from "@/lib/core/types";
import { formatAmount, sumAmounts } from "@/lib/core/money";
import { dateTimeText } from "@/lib/ui/date-text";

/** Invoiced, not yet settled. `underpaid` counts at the full total because the rest is still owed. */
const UNSETTLED: readonly InvoiceStatus[] = ["open", "payment_detected", "processing", "underpaid"];

/** Money that arrived, however unevenly. */
const SETTLED: readonly InvoiceStatus[] = ["paid", "overpaid", "paid_after_cancel"];

/** The states where somebody has to decide something. Same group as the invoice list's tab. */
const ATTENTION: readonly InvoiceStatus[] = ["underpaid", "overpaid", "paid_after_cancel", "failed", "refunded"];

const ATTENTION_REASON: Record<string, string> = {
  underpaid: "Less arrived than the invoice asked for.",
  overpaid: "More than one payment reached this invoice.",
  paid_after_cancel: "Cancelled, but a payment arrived anyway.",
  failed: "The conversion could not complete, so nothing was delivered.",
  refunded: "A payment came back to the client, so the invoice is open again.",
};

export default function Page() {
  const invoices = useInvoices();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">What you have invoiced, and what still needs you.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={EXPORT_CSV_PATH}
            className={buttonClass({ variant: "secondary", size: "sm" })}
            download
          >
            Export CSV
          </a>
          <Link href="/invoices/new" className={buttonClass({ variant: "primary", size: "sm" })}>
            New invoice
          </Link>
        </div>
      </header>

      {invoices.isPending ? (
        <p className="text-sm text-ink-muted">Loading your numbers…</p>
      ) : invoices.isError ? (
        <ErrorCard title="Your numbers could not be loaded" error={invoices.error} onRetry={() => invoices.refetch()} />
      ) : (
        <Summary invoices={invoices.data} />
      )}
    </div>
  );
}

function Summary({ invoices }: { invoices: InvoiceView[] }) {
  const unsettled = invoices.filter((invoice) => UNSETTLED.includes(invoice.status));
  const settled = invoices.filter((invoice) => SETTLED.includes(invoice.status));
  const attention = invoices.filter((invoice) => ATTENTION.includes(invoice.status));
  const recent = [...invoices]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Still owed to you">
          <Amounts list={unsettled} empty="Nothing is waiting on a payment right now." />
          <p className="mt-2 text-xs text-ink-faint">
            {unsettled.length} {unsettled.length === 1 ? "invoice" : "invoices"} awaiting, converting, or
            short. Cancelled, failed and refunded invoices are not counted here.
          </p>
        </Card>
        <Card title="Settled">
          <Amounts list={settled} empty="No invoice has been paid yet." />
          <p className="mt-2 text-xs text-ink-faint">
            {settled.length} {settled.length === 1 ? "invoice" : "invoices"} recorded as paid, including
            any that arrived over or after a cancel.
          </p>
        </Card>
      </div>

      <Card title="Needs your attention" description="Every invoice where the money did not arrive exactly as asked.">
        {attention.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing needs a decision.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {attention.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-3 last:border-0 last:pb-0">
                <StatusBadge status={invoice.status} />
                <Link href={`/invoices/${invoice.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
                  {invoice.number} · {invoice.clientName}
                </Link>
                {invoice.total ? <Money money={invoice.total} className="text-sm" /> : null}
                <span className="text-xs text-ink-muted">{ATTENTION_REASON[invoice.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent activity" description="The last six invoices your account touched.">
        {recent.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              No invoices yet. The first one takes about a minute: who it is for, what you did, the total.
            </p>
            <div>
              <Link href="/invoices/new" className={buttonClass({ variant: "secondary" })}>
                New invoice
              </Link>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {recent.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusBadge status={invoice.status} />
                <Link href={`/invoices/${invoice.id}`} className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline">
                  {invoice.number} · {invoice.clientName}
                </Link>
                {invoice.total ? <Money money={invoice.total} className="text-sm" /> : null}
                <span className="text-xs text-ink-faint">{dateTimeText(invoice.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * One line per token. Adding USDC on one chain to USDC on another would be a sum nobody can check, so
 * the groups stay apart and only the unresolved count is merged into a sentence.
 */
function Amounts({ list, empty }: { list: InvoiceView[]; empty: string }) {
  const totals = sumByAsset(list);
  const unresolved = list.filter((invoice) => invoice.total === null).length;

  if (totals.length === 0) {
    return (
      <>
        <p className="text-sm text-ink-muted">{unresolved > 0 ? "Amounts not resolved yet." : empty}</p>
        {unresolved > 0 ? <Unresolved count={unresolved} /> : null}
      </>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-1">
        {totals.map((money) => (
          <li key={money.assetId}>
            <Money money={money} className="text-xl font-semibold" />
          </li>
        ))}
      </ul>
      {unresolved > 0 ? <Unresolved count={unresolved} /> : null}
    </>
  );
}

function Unresolved({ count }: { count: number }) {
  return (
    <p className="mt-1 text-xs text-warn">
      {count} {count === 1 ? "invoice is" : "invoices are"} priced in a token that could not be read from
      the live list, so they add to no total here.
    </p>
  );
}

function sumByAsset(list: InvoiceView[]): MoneyView[] {
  const groups = new Map<string, { parts: BaseUnits[]; symbol: string | null; decimals: number | null }>();
  for (const invoice of list) {
    const total = invoice.total;
    if (total === null) continue;
    const group = groups.get(total.assetId) ?? { parts: [], symbol: total.symbol, decimals: total.decimals };
    group.parts.push(total.baseUnits);
    groups.set(total.assetId, group);
  }

  return [...groups.entries()].map(([assetId, group]) => {
    const baseUnits = sumAmounts(group.parts);
    return {
      assetId,
      baseUnits,
      symbol: group.symbol,
      decimals: group.decimals,
      amount: group.decimals === null ? null : formatAmount(baseUnits, group.decimals),
    };
  });
}
