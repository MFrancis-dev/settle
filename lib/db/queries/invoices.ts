/**
 * `invoices` + `invoice_items` queries.
 * Roadmap: S2.9 · Spec: ARCHITECTURE.md §4, §5
 *
 * Amounts never round-trip through the database unvalidated: `numeric(78,0)` comes back as a
 * plain string, so every read re-brands it with `parseBaseUnits`. The total is always the value
 * `computeInvoice` produced (the sum of the rounded lines) and is never re-derived here.
 *
 * Invoice numbers are per user (`INV-0001`, SD-6) and allocated under the
 * `invoices_user_number_uq` index. Two concurrent creates can compute the same next number, so
 * the insert uses `onConflictDoNothing` and retries — the index decides, not a read-then-write.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { customAlphabet } from "nanoid";

import type { BaseUnits, InvoiceLineInput } from "../../core/types";
import { computeInvoice, nextInvoiceNumber } from "../../core/invoice";
import type { InvoiceStatus } from "../../core/status";
import { parseBaseUnits } from "../../core/money";
import type { Database } from "../client";
import { invoiceItems, invoices, type Invoice, type InvoiceItem } from "../schema";

/** URL-safe and short enough to read aloud in a support call. */
const PUBLIC_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const newPublicId = customAlphabet(PUBLIC_ID_ALPHABET, 16);

const NUMBER_ALLOCATION_ATTEMPTS = 3;

export interface InvoiceLineRecord {
  description: string;
  quantity: string;
  unitPrice: BaseUnits;
  amount: BaseUnits;
  position: number;
}

export interface InvoiceRecord extends Invoice {
  /** `invoices.total` widened back to the money brand. */
  total: BaseUnits;
  status: InvoiceStatus;
  lines: InvoiceLineRecord[];
}

export interface CreateInvoiceInput {
  userId: string;
  clientName: string;
  clientEmail?: string | null;
  memo?: string | null;
  /** `YYYY-MM-DD`, the date column's own format. */
  dueDate?: string | null;
  lines: readonly InvoiceLineInput[];
  /** Mirrors the schema default: an invoice is a draft until it is sent. */
  status?: InvoiceStatus;
}

/**
 * `numeric(18,4)` comes back scale-padded ("1.5000"), which would show up in the UI and in any
 * re-quote of a stored line; hand back the quantity the way it was written.
 */
function trimQuantity(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function toBaseUnitsList(items: readonly InvoiceItem[]): InvoiceLineRecord[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      description: item.description,
      quantity: trimQuantity(item.quantity),
      unitPrice: parseBaseUnits(item.unitPrice),
      amount: parseBaseUnits(item.amount),
      position: item.position,
    }));
}

function toRecord(invoice: Invoice, items: readonly InvoiceItem[]): InvoiceRecord {
  return { ...invoice, total: parseBaseUnits(invoice.total), lines: toBaseUnitsList(items) };
}

async function existingNumbers(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ number: invoices.number })
    .from(invoices)
    .where(eq(invoices.userId, userId));
  return rows.map((row) => row.number);
}

/**
 * Write an invoice and its lines in one transaction.
 *
 * An empty `lines` array is rejected by `computeInvoice`, so an invoice can never be stored with
 * a total nobody can account for.
 */
export async function createInvoice(
  db: Database,
  input: CreateInvoiceInput,
): Promise<InvoiceRecord> {
  const computed = computeInvoice(input.lines);

  for (let attempt = 0; attempt < NUMBER_ALLOCATION_ATTEMPTS; attempt += 1) {
    const number = nextInvoiceNumber(await existingNumbers(db, input.userId));
    const publicId = newPublicId();

    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(invoices)
        .values({
          publicId,
          userId: input.userId,
          number,
          clientName: input.clientName,
          clientEmail: input.clientEmail ?? null,
          memo: input.memo ?? null,
          total: computed.total,
          dueDate: input.dueDate ?? null,
          status: input.status ?? "draft",
        })
        .onConflictDoNothing({ target: [invoices.userId, invoices.number] })
        .returning();

      const invoice = inserted[0];
      if (!invoice) return null;

      await tx.insert(invoiceItems).values(
        computed.lines.map((line, index) => ({
          invoiceId: invoice.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          position: index,
        })),
      );
      return invoice;
    });

    if (created) return toRecord(created, await itemsFor(db, created.id));
  }

  throw new Error(
    `could not allocate an invoice number for user ${input.userId} after ${NUMBER_ALLOCATION_ATTEMPTS} attempts`,
  );
}

async function itemsFor(db: Database, invoiceId: string): Promise<readonly InvoiceItem[]> {
  return db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
}

export async function getInvoiceById(db: Database, id: string): Promise<InvoiceRecord | null> {
  const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  const invoice = rows[0];
  if (!invoice) return null;
  return toRecord(invoice, await itemsFor(db, invoice.id));
}

/** What the public pay page resolves: a UUID-ish link slug, not a database id. */
export async function getInvoiceByPublicId(
  db: Database,
  publicId: string,
): Promise<InvoiceRecord | null> {
  const rows = await db.select().from(invoices).where(eq(invoices.publicId, publicId)).limit(1);
  const invoice = rows[0];
  if (!invoice) return null;
  return toRecord(invoice, await itemsFor(db, invoice.id));
}

export interface ListInvoicesOptions {
  statuses?: readonly InvoiceStatus[];
  limit?: number;
}

export async function listInvoicesForUser(
  db: Database,
  userId: string,
  options: ListInvoicesOptions = {},
): Promise<readonly InvoiceRecord[]> {
  const found = options.statuses
    ? await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.userId, userId), inArray(invoices.status, [...options.statuses])))
        .orderBy(desc(invoices.createdAt))
        .limit(options.limit ?? 50)
    : await db
        .select()
        .from(invoices)
        .where(eq(invoices.userId, userId))
        .orderBy(desc(invoices.createdAt))
        .limit(options.limit ?? 50);

  if (found.length === 0) return [];

  const allItems = await db
    .select()
    .from(invoiceItems)
    .where(
      inArray(
        invoiceItems.invoiceId,
        found.map((invoice) => invoice.id),
      ),
    )
    .orderBy(asc(invoiceItems.position));

  return found.map((invoice) =>
    toRecord(
      invoice,
      allItems.filter((item) => item.invoiceId === invoice.id),
    ),
  );
}

/**
 * Persist a derived status. `paidAt` is stamped the first time an invoice reaches a settled
 * status and never overwritten, so the receipt keeps the moment the money actually arrived.
 */
export async function setInvoiceStatus(
  db: Database,
  input: { invoiceId: string; status: InvoiceStatus; at?: Date },
): Promise<InvoiceRecord | null> {
  const settled = input.status === "paid" || input.status === "overpaid";
  await db
    .update(invoices)
    .set({
      status: input.status,
      updatedAt: input.at ?? new Date(),
      ...(settled ? { paidAt: input.at ?? new Date() } : {}),
    })
    .where(eq(invoices.id, input.invoiceId));

  return getInvoiceById(db, input.invoiceId);
}

/**
 * Cancel is a status plus a timestamp, not a deletion: an invoice that was already paid must
 * still be reconcilable (`paid_after_cancel`), and the pay page has to keep working to show it.
 */
export async function cancelInvoice(
  db: Database,
  invoiceId: string,
  at: Date = new Date(),
): Promise<InvoiceRecord | null> {
  await db
    .update(invoices)
    .set({ status: "cancelled", cancelledAt: at, updatedAt: at })
    .where(eq(invoices.id, invoiceId));
  return getInvoiceById(db, invoiceId);
}
