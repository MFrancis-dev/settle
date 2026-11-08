"use client";

/**
 * The invoice list, on any screen that shows more than one invoice.
 * Roadmap: S4.3 · Spec: PRD FR-19, §7 (mobile first)
 *
 * Three columns survive on a phone, so the list stays one table instead of a second mobile-only
 * markup that can drift. The pay link — the thing a freelancer actually wants — is the row's action.
 */

import Link from "next/link";

import type { InvoiceView } from "@/lib/api/types";
import { StatusBadge } from "./StatusBadge";
import { Money } from "@/components/ui/money";
import { CopyButton } from "@/components/ui/copy-button";
import { dateText } from "@/lib/ui/date-text";

export function InvoiceTable({ invoices }: { invoices: InvoiceView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Invoices</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-faint">
            <th scope="col" className="py-2 pr-4 font-medium">
              Invoice
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Status
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Total
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="hidden sm:inline">Pay link</span>
              <span className="sm:hidden">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="border-b border-line/60 align-top">
              <td className="py-3 pr-4">
                <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                  {invoice.number}
                </Link>
                <p className="mt-0.5 max-w-[16rem] truncate text-ink-muted">{invoice.clientName}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {invoice.dueDate
                    ? `Due ${dateText(invoice.dueDate)}`
                    : `Issued ${dateText(invoice.createdAt)}`}
                </p>
              </td>
              <td className="py-3 pr-4">
                <StatusBadge status={invoice.status} />
              </td>
              <td className="py-3 pr-4 text-right">
                {invoice.total ? (
                  <Money money={invoice.total} className="justify-end font-medium" />
                ) : (
                  <span className="text-xs text-ink-faint">
                    Set a payout address to see the total
                  </span>
                )}
              </td>
              <td className="py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <a
                    href={invoice.payUrl}
                    className="text-sm text-ink underline underline-offset-4"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pay
                  </a>
                  <span className="hidden sm:inline">
                    <CopyButton value={invoice.payUrl} label="Copy link" />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
