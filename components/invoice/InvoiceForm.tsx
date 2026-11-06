"use client";

/**
 * Write an invoice: who owes what, for which work, in the asset the freelancer is paid in.
 * Roadmap: S4.3 · Spec: PRD FR-5, FR-7, FR-8 (nothing exists until the total is right)
 *
 * The total shown while typing is computed by the same pure function the server uses
 * (`computeInvoice`), so the preview and the stored invoice cannot disagree. Unit prices are typed in
 * the payout asset's display units and converted to exact base units here, because the API only ever
 * accepts base units — a float never leaves the field.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ApiError } from "@/lib/api/client";
import { useCreateInvoice, useMe } from "@/lib/api/queries";
import { createInvoiceInput, type CreateInvoiceInput } from "@/lib/core/schemas";
import { computeInvoice } from "@/lib/core/invoice";
import { formatAmount, toBaseUnitsRounded } from "@/lib/core/money";
import type { BaseUnits, InvoiceLineInput } from "@/lib/core/types";
import { groupDecimal } from "@/lib/ui/money-text";

interface LineDraft {
  description: string;
  quantity: string;
  /** Display units, as typed. `unitPriceBase` is what the API wants, or null when it cannot be read. */
  unitPrice: string;
}

const BLANK_LINE: LineDraft = { description: "", quantity: "1", unitPrice: "" };

export function InvoiceForm() {
  const me = useMe();
  const create = useCreateInvoice();
  const router = useRouter();

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [memo, setMemo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([BLANK_LINE]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const decimals = me.data?.payout?.decimals ?? null;
  const symbol = me.data?.payout?.assetSymbol ?? null;

  /**
   * Every row converted to what the API accepts, or null when a price still cannot be read as a
   * number. `errors` names the rows so the field says which one, instead of the total just vanishing.
   */
  const priced = useMemo<{
    items: InvoiceLineInput[] | null;
    errors: Record<string, string>;
  }>(() => {
    if (decimals === null) return { items: null, errors: {} };
    const items: InvoiceLineInput[] = [];
    const errors: Record<string, string> = {};
    for (const [index, line] of lines.entries()) {
      const unitPrice = safeBase(line.unitPrice, decimals);
      if (unitPrice === null) {
        errors[`items.${index}.unitPrice`] = "Enter an amount in whole or decimal units.";
        continue;
      }
      items.push({ description: line.description.trim(), quantity: line.quantity, unitPrice });
    }
    return { items: Object.keys(errors).length > 0 ? null : items, errors };
  }, [lines, decimals]);

  const preview = useMemo(() => {
    if (priced.items === null) return null;
    try {
      return computeInvoice(priced.items);
    } catch {
      // A quantity the core rejects is reported by the schema check on submit, not by a fake total.
      return null;
    }
  }, [priced.items]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit() {
    if (decimals === null) return;
    setFieldErrors({});
    if (priced.items === null) {
      setFieldErrors(priced.errors);
      return;
    }

    const input: CreateInvoiceInput = {
      clientName: clientName.trim(),
      ...(clientEmail.trim() ? { clientEmail: clientEmail.trim() } : {}),
      ...(memo.trim() ? { memo: memo.trim() } : {}),
      ...(dueDate ? { dueDate } : {}),
      items: priced.items.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    };

    // Same schema the route uses, so a mistake is caught before it costs a round trip.
    const parsed = createInvoiceInput.safeParse(input);
    if (!parsed.success) {
      setFieldErrors(indexIssues(parsed.error));
      return;
    }

    try {
      const invoice = await create.mutateAsync(parsed.data);
      router.push(`/invoices/${invoice.id}`);
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(indexIssues(error.issues));
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {me.isPending ? (
        <p className="text-sm text-ink-muted">Loading your payout details…</p>
      ) : decimals === null ? (
        <Alert tone="warn" title="Choose where you want to be paid first">
          An invoice is written in the asset you receive, so Settle needs a payout address before it
          can show amounts.{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Set it in settings
          </Link>
          .
        </Alert>
      ) : null}

      <Card title="Who is being invoiced">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Client name"
            required
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            error={fieldErrors.clientName}
            autoComplete="organization"
          />
          <TextField
            label="Client email"
            type="email"
            hint="Optional. Only used to remind them, never to sign anything."
            value={clientEmail}
            onChange={(event) => setClientEmail(event.target.value)}
            error={fieldErrors.clientEmail}
            autoComplete="email"
          />
          <TextField
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            error={fieldErrors.dueDate}
          />
        </div>
        <div className="mt-4">
          <TextAreaField
            label="Note for the client"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            error={fieldErrors.memo}
          />
        </div>
      </Card>

      <Card
        title="Work"
        description={`Amounts are in ${symbol ?? "the asset you chose to be paid in"}. Each line is rounded to the smallest unit of that asset.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLines((current) => [...current, BLANK_LINE])}
          >
            Add line
          </Button>
        }
      >
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <li key={index} className="flex flex-wrap items-end gap-3">
              <TextField
                className="min-w-0 flex-1 basis-56"
                label={`Description${lines.length > 1 ? ` (line ${index + 1})` : ""}`}
                placeholder="Design work, 3 days"
                value={line.description}
                onChange={(event) => updateLine(index, { description: event.target.value })}
                error={fieldErrors[`items.${index}.description`]}
              />
              <TextField
                className="w-24 shrink-0"
                label="Qty"
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
                error={fieldErrors[`items.${index}.quantity`]}
              />
              <TextField
                className="w-40 shrink-0"
                label={`Unit ${symbol ?? "price"}`}
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                error={fieldErrors[`items.${index}.unitPrice`]}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mb-1"
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4">
          <span className="text-sm text-ink-muted">Total your client pays</span>
          <span className="money text-xl font-semibold">
            {preview && decimals !== null
              ? `${formatAmount(preview.total, decimals)} ${symbol ?? ""}`.trim()
              : "—"}
          </span>
        </div>
        {preview && decimals !== null ? (
          <p className="mt-1 text-right text-xs text-ink-faint">
            {groupDecimal(preview.total)} base units · exact, never rounded up
          </p>
        ) : null}
      </Card>

      {create.isError ? (
        <Alert tone="danger" title="The invoice could not be created">
          {create.error instanceof Error ? create.error.message : "Unknown error."}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" pending={create.isPending} disabled={decimals === null}>
          Create invoice
        </Button>
        <Button
          variant="secondary"
          size="lg"
          type="button"
          onClick={() => router.push("/invoices")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A typed price in display units, or null when it is not a usable number. Never a float. */
function safeBase(display: string, decimals: number): BaseUnits | null {
  if (!/^\d+(\.\d*)?$/.test(display.trim())) return null;
  try {
    return toBaseUnitsRounded(display.trim(), decimals);
  } catch {
    return null;
  }
}

/** `items.0.unitPrice` → a lookup the fields can read, first message per path wins. */
function indexIssues(
  source: z.ZodError | { path: string; message: string }[],
): Record<string, string> {
  const list = Array.isArray(source)
    ? source
    : source.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  const map: Record<string, string> = {};
  for (const issue of list) {
    map[issue.path] ??= issue.message;
  }
  return map;
}
