"use client";

/**
 * One invoice, everything the freelancer can do about it.
 * Roadmap: S4.3 · Spec: PRD FR-8 (share the link), FR-9, FR-19, §6 (the payout address stays private)
 *
 * The pay link is the first thing on the screen because it is the only thing the freelancer has to
 * do; attempts come next, in the order the client's payments happened.
 */

import Link from "next/link";
import { useParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, DefinitionList } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Money, MoneyExact } from "@/components/ui/money";
import { AttemptStatusBadge, StatusBadge } from "@/components/invoice/StatusBadge";
import { LineItems } from "@/components/invoice/LineItems";
import { useCancelInvoice, useInvoice } from "@/lib/api/queries";
import { receiptHref } from "@/lib/api/receipt-link";
import type { AttemptView } from "@/lib/api/types";
import { canCancel } from "@/lib/ui/status";
import { dateText, dateTimeText } from "@/lib/ui/date-text";
import { usdText } from "@/lib/ui/money-text";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  const cancel = useCancelInvoice(id);

  if (invoice.isPending) return <p className="text-sm text-ink-muted">Loading invoice…</p>;
  if (invoice.isError || !invoice.data) {
    return (
      <Alert tone="danger" title="This invoice could not be opened">
        {invoice.error instanceof Error ? invoice.error.message : "Unknown error."}
        <div className="mt-3">
          <Link href="/invoices" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Back to invoices
          </Link>
        </div>
      </Alert>
    );
  }

  const view = invoice.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-ink-muted hover:text-ink">
            ← Invoices
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{view.number}</h1>
          <p className="mt-1 text-sm text-ink-muted">{view.clientName}</p>
        </div>
        <StatusBadge status={view.status} />
      </div>

      <Card
        title="Share the payment link"
        description="Anyone with this link can pay. It shows the invoice, not your account."
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 basis-64 truncate rounded-control border border-line bg-surface-sunk px-3 py-2 font-mono text-xs">
            {view.payUrl}
          </p>
          <CopyButton value={view.payUrl} label="Copy link" />
          <a
            href={view.payUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Open
          </a>
        </div>
      </Card>

      <Card title="Amount">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {view.total ? (
            <div>
              <p className="text-2xl font-semibold">
                <Money money={view.total} />
              </p>
              <MoneyExact money={view.total} />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              No payout address is set, so the total cannot be shown yet.{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Set one
              </Link>
              .
            </p>
          )}
          {canCancel(view.status) ? (
            <Button
              variant="danger"
              size="sm"
              pending={cancel.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Cancel this invoice? A payment that still arrives is kept and marked as paid after cancellation.",
                  )
                ) {
                  cancel.mutate();
                }
              }}
            >
              Cancel invoice
            </Button>
          ) : null}
        </div>
        {cancel.isError ? (
          <div className="mt-3">
            <Alert tone="danger" title="The invoice was not cancelled">
              {cancel.error instanceof Error ? cancel.error.message : "Unknown error."}
            </Alert>
          </div>
        ) : null}
      </Card>

      <Card title="Work">
        <LineItems lines={view.lines} total={view.total} />
        {view.memo ? (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-xs text-ink-faint">Note to client</h3>
            <p className="mt-1 whitespace-pre-line text-sm">{view.memo}</p>
          </div>
        ) : null}
        <div className="mt-4 border-t border-line pt-4">
          <DefinitionList
            items={[
              { label: "Issued", value: dateText(view.createdAt) },
              { label: "Due", value: view.dueDate ? dateText(view.dueDate) : "No due date" },
              { label: "Paid", value: view.paidAt ? dateTimeText(view.paidAt) : "Not yet" },
              {
                label: "Cancelled",
                value: view.cancelledAt ? dateTimeText(view.cancelledAt) : "—",
              },
            ]}
          />
        </div>
      </Card>

      <Card
        title="Payments"
        description="Each row is one address the client was given. A new quote is made whenever the old one runs out."
      >
        {view.attempts.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Your client has not asked for a payment address yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {view.attempts.map((attempt) => (
              <li key={attempt.id}>
                <Attempt attempt={attempt} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Attempt({ attempt }: { attempt: AttemptView }) {
  const fee = usdText(attempt.feeUsd);
  return (
    <article className="rounded-card border border-line bg-surface-sunk/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AttemptStatusBadge status={attempt.status} />
        <span className="text-xs text-ink-faint">
          Quoted until {dateTimeText(attempt.quoteDeadline)}
        </span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-faint">Client sent</dt>
          <dd className="mt-0.5">
            <Money money={attempt.originAsset} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">You receive</dt>
          <dd className="mt-0.5">
            <Money money={attempt.payoutAsset} />
          </dd>
        </div>
        {/* A short payment is the freelancer's decision to chase, so the exact figure belongs here
            and not only on the client's screen (S7.1). */}
        {attempt.shortfall ? (
          <div>
            <dt className="text-xs text-warn">Still owed by the client</dt>
            <dd className="mt-0.5 text-warn">
              <Money money={attempt.shortfall} />
            </dd>
          </div>
        ) : null}
        {attempt.refunded ? (
          <div>
            <dt className="text-xs text-ink-faint">
              Sent back to the client
            </dt>
            <dd className="mt-0.5">
              <Money money={attempt.refunded} />
              {attempt.refundReason ? (
                <span className="ml-2 text-xs text-ink-muted">{attempt.refundReason}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-xs text-ink-faint">Deposit address</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="min-w-0 max-w-full break-all font-mono text-xs">
              {attempt.depositAddress}
            </span>
            <CopyButton value={attempt.depositAddress} label="Copy" />
            {attempt.depositMemo ? (
              <span className="font-mono text-xs text-ink-muted">memo {attempt.depositMemo}</span>
            ) : null}
          </dd>
        </div>
        {fee ? (
          <div>
            <dt className="text-xs text-ink-faint">Conversion fee</dt>
            <dd className="mt-0.5">{fee}</dd>
          </div>
        ) : null}
        {attempt.depositTxHash ? (
          <div>
            <dt className="text-xs text-ink-faint">Payment reference</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{attempt.depositTxHash}</dd>
          </div>
        ) : null}
      </dl>
      {attempt.receiptUrl ? (
        <div className="mt-3">
          <a
            href={receiptHref({ ...attempt, receiptUrl: attempt.receiptUrl })}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Receipt
          </a>
        </div>
      ) : null}
    </article>
  );
}
