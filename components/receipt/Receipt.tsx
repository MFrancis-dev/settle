"use client";

/**
 * The printable receipt both sides keep.
 * Roadmap: S4.6 · Spec: PRD FR-18, ARCHITECTURE.md §4 (the record is the document)
 *
 * It prints what was *stored*: the signed quote (what was promised) and the status payload 1Click sent
 * back (what actually moved). The payer's refund address is not here — the API withholds it, because a
 * receipt gets forwarded and printed, and a document that travels should not carry somebody's wallet
 * address.
 */

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Money, MoneyExact } from "@/components/ui/money";
import { AttemptStatusBadge } from "@/components/invoice/StatusBadge";
import type { ReceiptLink, ReceiptView } from "@/lib/api/types";
import { dateTimeText } from "@/lib/ui/date-text";
import { usdText } from "@/lib/ui/money-text";

export function Receipt({ receipt }: { receipt: ReceiptView }) {
  const fee = usdText(receipt.feeUsd);

  return (
    <Card
      title={`Receipt · ${receipt.invoice.number}`}
      actions={
        <button type="button" className={`${buttonClass({ variant: "secondary", size: "sm" })} no-print`} onClick={() => window.print()}>
          Print or save as PDF
        </button>
      }
    >
      <article className="flex flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-muted">Payment to</p>
            <p className="text-lg font-semibold">{receipt.seller}</p>
          </div>
          <AttemptStatusBadge status={receipt.status} />
        </header>

        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="You sent">
            <Money money={receipt.sent} className="text-base font-semibold" />
            <MoneyExact money={receipt.sent} />
          </Field>
          <Field label="The seller received">
            <Money money={receipt.delivered} className="text-base font-semibold" />
            <MoneyExact money={receipt.delivered} />
          </Field>
          <Field label="Conversion fee">{fee ?? "Included"}</Field>
          <Field label="Paid at">{receipt.paidAt ? dateTimeText(receipt.paidAt) : "Not yet settled"}</Field>
          <Field label="Invoice for">{receipt.invoice.clientName}</Field>
          <Field label="Issued">{dateTimeText(receipt.invoice.issuedAt)}</Field>
          <Field label="Deposit address">
            <span className="break-all font-mono text-xs">{receipt.deposit.address}</span>
            {receipt.deposit.memo ? <span className="ml-2 font-mono text-xs">memo {receipt.deposit.memo}</span> : null}
          </Field>
          <Field label="Price was held until">{dateTimeText(receipt.quoteDeadline)}</Field>
        </dl>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-ink-faint">Transactions</h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            <TxList caption="Into Settle" links={receipt.depositTxs} />
            <TxList caption="Out to the seller" links={receipt.deliveryTxs} />
          </ul>
        </section>

        <section className="border-t border-line pt-3">
          <h3 className="text-xs uppercase tracking-wide text-ink-faint">Quote attestation</h3>
          <p className="mt-1 break-all font-mono text-xs">{receipt.quoteSignature}</p>
          <p className="mt-1 text-xs text-ink-muted">
            The exchange’s signature over these exact figures. It is what a dispute starts from.
          </p>
        </section>

        <footer className="text-xs text-ink-faint">
          <p>
            Settle · receipt for invoice {receipt.invoice.number}
            {receipt.oneclickStatus ? ` · exchange status ${receipt.oneclickStatus}` : ""}
          </p>
          <p className="mt-1">These are the exact figures recorded at settlement.</p>
        </footer>
      </article>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function TxList({ caption, links }: { caption: string; links: ReceiptLink[] }) {
  if (links.length === 0) {
    return (
      <li className="text-ink-muted">
        {caption}: no transaction reference recorded yet.
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-1">
      <span className="text-ink-muted">{caption}</span>
      {links.map((link) => (
        <span key={link.hash} className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-xs">{link.hash}</span>
          {link.url ? (
            <a href={link.url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">
              View
            </a>
          ) : (
            <CopyButton value={link.hash} label="Copy" />
          )}
        </span>
      ))}
    </li>
  );
}
