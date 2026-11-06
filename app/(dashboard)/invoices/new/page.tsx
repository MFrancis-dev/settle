"use client";

/**
 * Create an invoice.
 * Roadmap: S4.3 · Spec: PRD FR-5, FR-7
 *
 * The page is a heading and the form; the rules that decide when an invoice may exist live in
 * `InvoiceForm`, so the same screen works as a full-page sheet on a phone.
 */

import Link from "next/link";

import { InvoiceForm } from "@/components/invoice/InvoiceForm";

export default function Page() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/invoices" className="text-sm text-ink-muted hover:text-ink">
          ← Invoices
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">New invoice</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nothing is sent to your client until you copy the pay link from the next screen.
        </p>
      </div>
      <InvoiceForm />
    </div>
  );
}
