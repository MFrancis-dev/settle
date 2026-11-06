"use client";

/**
 * The client's live view of their own payment.
 * Roadmap: S4.5 · Spec: PRD FR-17 (status visible within ~10 s), FR-10, §7
 *
 * The words come from `clientMessage` in `lib/ui/status.ts`, which covers every invoice status, so a
 * state the API can return is never rendered as silence. The poll rewrites this block on its own
 * schedule, so the whole thing is one polite live region: a change nobody triggered still gets
 * announced, without interrupting somebody who is mid-sentence.
 */

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { AttemptStatusBadge } from "@/components/invoice/StatusBadge";
import { Money } from "@/components/ui/money";
import { clientMessage } from "@/lib/ui/status";
import { receiptHref } from "@/lib/api/receipt-link";
import type { StatusView } from "@/lib/api/types";

export function PayStatus({ status, actions }: { status: StatusView; actions?: ReactNode }) {
  const sentence = clientMessage({ status: status.invoiceStatus, pollReason: status.pollReason });
  const failed = status.invoiceStatus === "failed" || status.invoiceStatus === "refunded";

  return (
    <div aria-live="polite" className="contents">
      <Card title="Your payment">
        <div className="flex flex-wrap items-center gap-3">
          {status.attempt ? <AttemptStatusBadge status={status.attempt.status} /> : null}
          {status.pollReason === "upstream_unreachable" ? (
            <span className="text-xs text-warn">Status could not be refreshed just now</span>
          ) : null}
        </div>

        {sentence ? <p className={`mt-3 text-sm ${failed ? "text-danger" : ""}`}>{sentence}</p> : null}

        {status.attempt ? (
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-faint">You sent</dt>
              <dd className="mt-0.5">
                <Money money={status.attempt.originAsset} />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-faint">
                {status.paid ? "The seller received" : "Settles as"}
              </dt>
              <dd className="mt-0.5">
                <Money money={status.attempt.payoutAsset} />
              </dd>
            </div>
            {status.attempt.depositTxHash ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Your transaction reference</dt>
                <dd className="mt-0.5 break-all font-mono text-xs">{status.attempt.depositTxHash}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status.receiptUrl && status.attempt ? (
            <a
              href={receiptHref({ id: status.attempt.id, receiptUrl: status.receiptUrl })}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Receipt
            </a>
          ) : null}
          {actions}
        </div>
      </Card>
    </div>
  );
}
