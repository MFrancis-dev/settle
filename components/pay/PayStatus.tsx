"use client";

/**
 * The client's live view of their own payment.
 * Roadmap: S4.5, S7.1 · Spec: PRD FR-17 (status visible within ~10 s), FR-10, §7
 *
 * The words come from `clientMessage` in `lib/ui/status.ts`, which covers every invoice status, so a
 * state the API can return is never rendered as silence. The poll rewrites this block on its own
 * schedule, so the whole thing is one polite live region: a change nobody triggered still gets
 * announced, without interrupting somebody who is mid-sentence.
 *
 * A short payment gets **numbers**, not just a sentence (S7.1): "send the difference" is only
 * actionable if the difference is stated, and the only honest source for it is what 1Click reported
 * as having landed, which the server stores and returns as `deposited`/`shortfall`.
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
  const attempt = status.attempt;

  return (
    <div aria-live="polite" className="contents">
      <Card title="Your payment">
        <div className="flex flex-wrap items-center gap-3">
          {attempt ? <AttemptStatusBadge status={attempt.status} /> : null}
          {status.pollReason === "upstream_unreachable" ? (
            <span className="text-xs text-warn">Status could not be refreshed just now</span>
          ) : null}
        </div>

        {sentence ? (
          <p className={`mt-3 text-sm ${failed ? "text-danger" : ""}`}>{sentence}</p>
        ) : null}

        {attempt ? (
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-faint">You sent</dt>
              <dd className="mt-0.5">
                <Money money={attempt.originAsset} />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-faint">
                {status.paid ? "The seller received" : "Settles as"}
              </dt>
              <dd className="mt-0.5">
                <Money money={attempt.payoutAsset} />
              </dd>
            </div>
            {attempt.deposited ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Arrived</dt>
                <dd className="mt-0.5">
                  <Money money={attempt.deposited} />
                </dd>
              </div>
            ) : null}
            {attempt.shortfall ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-warn">Still owed</dt>
                <dd className="mt-0.5 text-warn">
                  <Money money={attempt.shortfall} />
                </dd>
              </div>
            ) : null}
            {attempt.refunded ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Sent back to you</dt>
                <dd className="mt-0.5">
                  <Money money={attempt.refunded} />
                  {attempt.refundReason ? (
                    <span className="ml-2 text-xs text-ink-muted">{attempt.refundReason}</span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {attempt.depositTxHash ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ink-faint">
                  Your transaction reference
                </dt>
                <dd className="mt-0.5 break-all font-mono text-xs">{attempt.depositTxHash}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {status.otherPayments.length > 0 ? (
          <div className="mt-4 rounded-card border border-line bg-surface-sunk/50 p-3">
            <p className="text-xs uppercase tracking-wide text-ink-faint">
              {status.otherPayments.length === 1
                ? "One other payment reached this invoice"
                : `${status.otherPayments.length} other payments reached this invoice`}
            </p>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {status.otherPayments.map((payment, index) => (
                // There is no id to key on: a public read of somebody else's payment carries none.
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <AttemptStatusBadge status={payment.status} />
                  {payment.refunded ? (
                    <span className="text-ink-muted">
                      <Money money={payment.refunded} /> sent back to the refund address given with
                      it
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status.receiptUrl && attempt ? (
            <a
              href={receiptHref({ id: attempt.id, receiptUrl: status.receiptUrl })}
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
