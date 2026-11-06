/**
 * The freelancer's invoice endpoints: create, list, detail, cancel, and the accountant's CSV.
 * Roadmap: S3.3, S3.7 · Spec: ARCHITECTURE.md §3.1, §5
 *
 * Ownership is checked on every read and write by filtering on the session's `userId`, and a row that
 * belongs to somebody else answers 404, not 403 — the same reply as a row that does not exist, so the
 * API cannot be used to probe which invoice ids other users hold (§6, invoice enumeration).
 */

import {
  createInvoiceInput,
  invoiceListQueryInput,
  type CreateInvoiceInput,
} from "../core/schemas";
import { isUuid } from "../core/ids";
import type { InvoiceStatus } from "../core/status";
import {
  cancelInvoice,
  createInvoice,
  getInvoiceById,
  listInvoicesForUser,
} from "../db/queries/invoices";
import type { InvoiceRecord } from "../db/queries/invoices";
import { listAttemptsForInvoice } from "../db/queries/paymentAttempts";
import { getActiveDestination } from "../db/queries/payoutDestinations";
import { conflict, forbidden, notFound, parseJsonBody, parseQuery } from "./http";
import { attemptView, invoiceView, type AttemptView, type InvoiceView } from "./views";
import type { Principal } from "./auth";
import type { ServerDeps } from "./deps";

/** A paid invoice is a financial record; cancelling it would rewrite what the client already sent. */
const SETTLED: readonly InvoiceStatus[] = ["paid", "overpaid", "paid_after_cancel"];

export interface InvoiceDetail extends InvoiceView {
  attempts: AttemptView[];
}

/**
 * Both id routes share this so "not yours" and "not there" and "not even shaped like one" all give
 * the same 404: the API must not confirm that an unknown invoice id exists (§6).
 */
async function ownedInvoice(
  deps: ServerDeps,
  principal: Principal,
  id: string,
): Promise<InvoiceRecord> {
  if (!isUuid(id)) throw notFound("No such invoice.");
  const invoice = await getInvoiceById(deps.db, id);
  if (!invoice || invoice.userId !== principal.user.id) throw notFound("No such invoice.");
  return invoice;
}

/** An invoice's total is denominated in the payout asset the seller is asking for today. */
async function payoutAssetId(deps: ServerDeps, invoice: InvoiceRecord): Promise<string | null> {
  const destination = await getActiveDestination(deps.db, invoice.userId);
  return destination?.assetId ?? null;
}

export async function invoiceSummary(
  deps: ServerDeps,
  invoice: InvoiceRecord,
): Promise<InvoiceView> {
  return invoiceView(deps, invoice, await payoutAssetId(deps, invoice));
}

/**
 * `POST /api/invoices`.
 *
 * A new invoice is `open`, not `draft`: the pay link the response returns is shareable the moment it
 * exists, and the MVP has no separate "send" step (§5). Amounts are the base-unit strings the client
 * sent; `computeInvoice` inside `createInvoice` is what adds them up.
 */
export async function create(
  deps: ServerDeps,
  principal: Principal,
  input: CreateInvoiceInput,
): Promise<InvoiceView> {
  const record = await createInvoice(deps.db, {
    userId: principal.user.id,
    clientName: input.clientName,
    clientEmail: input.clientEmail ?? null,
    memo: input.memo ?? null,
    dueDate: input.dueDate ?? null,
    lines: input.items,
    status: "open",
  });
  return invoiceSummary(deps, record);
}

export async function list(
  deps: ServerDeps,
  principal: Principal,
  searchParams: URLSearchParams,
): Promise<InvoiceView[]> {
  const query = parseQuery(searchParams, invoiceListQueryInput);
  const rows = await listInvoicesForUser(deps.db, principal.user.id, {
    ...(query.status ? { statuses: [query.status] } : {}),
    ...(query.limit ? { limit: query.limit } : {}),
  });
  return Promise.all(rows.map((row) => invoiceSummary(deps, row)));
}

/** `GET /api/invoices/:id` — the detail page: the invoice, plus every quote ever taken on it. */
export async function detail(
  deps: ServerDeps,
  principal: Principal,
  id: string,
): Promise<InvoiceDetail> {
  const invoice = await ownedInvoice(deps, principal, id);
  const attempts = await listAttemptsForInvoice(deps.db, invoice.id);
  return {
    ...(await invoiceSummary(deps, invoice)),
    attempts: await Promise.all(attempts.map((row) => attemptView(deps, row))),
  };
}

/**
 * `POST /api/invoices/:id/cancel` — a status and a timestamp, never a deletion (§4).
 *
 * An attempt that is still live keeps working: if the client pays after this call, the derived status
 * is `paid_after_cancel` and the money still arrives, which is the honest record of what happened.
 */
export async function cancel(
  deps: ServerDeps,
  principal: Principal,
  id: string,
): Promise<InvoiceView> {
  const invoice = await ownedInvoice(deps, principal, id);
  if (invoice.status === "cancelled") {
    return invoiceSummary(deps, invoice);
  }
  if (SETTLED.includes(invoice.status)) {
    throw conflict(`This invoice is already ${invoice.status}; it cannot be cancelled.`);
  }

  const cancelled = await cancelInvoice(deps.db, invoice.id, new Date(deps.now()));
  if (!cancelled) throw notFound("No such invoice.");
  return invoiceSummary(deps, cancelled);
}

/** A demo seller with a seeded `is_demo` row must not be able to export a real ledger. */
export function assertNotDemo(principal: Principal): void {
  if (principal.user.isDemo) {
    throw forbidden("Demo accounts cannot export the ledger.");
  }
}

const CSV_COLUMNS = [
  "invoice_number",
  "invoice_status",
  "client_name",
  "issued_at",
  "due_date",
  "paid_at",
  "payout_asset",
  "invoice_total_base_units",
  "invoice_total",
  "attempt_id",
  "attempt_status",
  "oneclick_status",
  "paid_in_asset",
  "paid_in_base_units",
  "paid_in",
  "delivered_asset",
  "delivered_base_units",
  "delivered",
  "fee_usd",
  "deposit_address",
  "deposit_memo",
  "deposit_tx_hash",
  "delivery_tx_hash",
  "quote_deadline",
  "pay_url",
  "receipt_url",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];
type CsvRow = Record<CsvColumn, string | null>;

/**
 * Quotes double, and a field containing a quote, comma or newline is wrapped. Excel agrees.
 *
 * A cell that starts with `=`, `+`, `-`, `@` or a tab is prefixed with `'` first: `client_name` and
 * `deposit_memo` are text someone else typed, and a spreadsheet will *run* a cell that starts that way.
 */
const FORMULA_LEAD = /^[=+\-@\t]/;

function csvCell(value: string | null): string {
  const text = FORMULA_LEAD.test(value ?? "") ? `'${value}` : (value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * `GET /api/export.csv` — one row per payment attempt, plus one row per invoice that has none.
 *
 * Both exact base units and formatted amounts are in every row: the units are what reconciles against
 * the chain, the formatted pair is what an accountant reads (PRD US-11, "opens without questions").
 * A row is keyed by column name, so a new field can never shift a spreadsheet sideways.
 */
export async function exportCsv(deps: ServerDeps, principal: Principal): Promise<string> {
  assertNotDemo(principal);
  const invoices = await listInvoicesForUser(deps.db, principal.user.id, { limit: 200 });

  const lines: string[] = [CSV_COLUMNS.join(",")];

  for (const invoice of invoices) {
    const destination = await getActiveDestination(deps.db, invoice.userId);
    const withAsset = await invoiceView(deps, invoice, destination?.assetId ?? null);

    const invoiceColumns: CsvRow = {
      invoice_number: withAsset.number,
      invoice_status: withAsset.status,
      client_name: withAsset.clientName,
      issued_at: withAsset.createdAt,
      due_date: withAsset.dueDate,
      paid_at: withAsset.paidAt,
      payout_asset: withAsset.total?.assetId ?? null,
      invoice_total_base_units: withAsset.total?.baseUnits ?? null,
      invoice_total: withAsset.total?.amount ?? null,
      attempt_id: null,
      attempt_status: null,
      oneclick_status: null,
      paid_in_asset: null,
      paid_in_base_units: null,
      paid_in: null,
      delivered_asset: null,
      delivered_base_units: null,
      delivered: null,
      fee_usd: null,
      deposit_address: null,
      deposit_memo: null,
      deposit_tx_hash: null,
      delivery_tx_hash: null,
      quote_deadline: null,
      pay_url: withAsset.payUrl,
      receipt_url: null,
    };

    const attempts = await listAttemptsForInvoice(deps.db, invoice.id);
    if (attempts.length === 0) {
      // An invoice with no attempt has no payment to report, so those columns stay empty rather
      // than being filled with the invoice's own numbers.
      lines.push(CSV_COLUMNS.map((name) => csvCell(invoiceColumns[name])).join(","));
      continue;
    }

    for (const attempt of await Promise.all(attempts.map((row) => attemptView(deps, row)))) {
      lines.push(
        CSV_COLUMNS.map((name) =>
          csvCell(
            {
              ...invoiceColumns,
              attempt_id: attempt.id,
              attempt_status: attempt.status,
              oneclick_status: attempt.oneclickStatus,
              paid_in_asset: attempt.originAsset.assetId,
              paid_in_base_units: attempt.originAsset.baseUnits,
              paid_in: attempt.originAsset.amount,
              delivered_asset: attempt.payoutAsset.assetId,
              delivered_base_units: attempt.payoutAsset.baseUnits,
              delivered: attempt.payoutAsset.amount,
              fee_usd: attempt.feeUsd,
              deposit_address: attempt.depositAddress,
              deposit_memo: attempt.depositMemo,
              deposit_tx_hash: attempt.depositTxHash,
              delivery_tx_hash: attempt.deliveryTxHash,
              quote_deadline: attempt.quoteDeadline,
              receipt_url: attempt.receiptUrl,
            }[name],
          ),
        ).join(","),
      );
    }
  }

  // CRLF and a trailing newline: the shape spreadsheets open without a warning banner.
  return `${lines.join("\r\n")}\r\n`;
}

export async function createFromBody(
  deps: ServerDeps,
  principal: Principal,
  request: Request,
): Promise<InvoiceView> {
  return create(deps, principal, await parseJsonBody(request, createInvoiceInput));
}
