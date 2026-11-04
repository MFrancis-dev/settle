/**
 * Invoice line math (round half-up per line, total = sum of lines) and numbering.
 * Roadmap: S1.2 · Spec: PRD.md FR-7, AGENTS.md §6
 *
 * Quantities are decimal strings with at most 4 places (matching `numeric(18,4)`); unit
 * prices and line amounts are base-unit strings. The multiply is the only place a line can
 * gain a fractional base unit, so it is where half-up happens — the total is an exact sum
 * of already-rounded lines, which is what the client is asked to pay.
 */

import { parseBaseUnits, roundHalfUp, sumAmounts } from "./money";
import type { BaseUnits, InvoiceLineInput } from "./types";

/** Quantities carry 4 decimal places, so 1 quantity unit = 10 000 ticks. */
const QUANTITY_SCALE = 10_000n;

const QUANTITY_RE = /^\d+(?:\.\d{1,4})?$/;

/** "2.5" → 25 000 ticks. Rejects anything the `invoiceLineInput` schema would not accept. */
export function quantityTicks(quantity: string): bigint {
  if (!QUANTITY_RE.test(quantity)) {
    throw new TypeError(`Quantity must be a decimal string with up to 4 places, got "${quantity}"`);
  }
  const dot = quantity.indexOf(".");
  if (dot === -1) return BigInt(quantity) * QUANTITY_SCALE;
  const whole = quantity.slice(0, dot);
  const fraction = quantity.slice(dot + 1).padEnd(4, "0");
  return BigInt(whole + fraction);
}

/** quantity × unit price, rounded half-up to a whole base unit. */
export function lineAmount(quantity: string, unitPrice: string): BaseUnits {
  const price = BigInt(parseBaseUnits(unitPrice));
  return parseBaseUnits(roundHalfUp(quantityTicks(quantity) * price, QUANTITY_SCALE).toString());
}

export interface InvoiceLine extends InvoiceLineInput {
  /** Derived: `lineAmount(quantity, unitPrice)`. */
  amount: BaseUnits;
}

/**
 * Resolve every line's amount and the invoice total. The total is the sum of rounded lines,
 * never a re-derivation from the raw quantities, so the stored lines always add up to it.
 */
export function computeInvoice(lines: readonly InvoiceLineInput[]): {
  lines: InvoiceLine[];
  total: BaseUnits;
} {
  if (lines.length === 0) throw new RangeError("An invoice needs at least one line");
  const resolved = lines.map((line) => ({
    ...line,
    amount: lineAmount(line.quantity, line.unitPrice),
  }));
  return { lines: resolved, total: sumAmounts(resolved.map((line) => line.amount)) };
}

/** Invoice numbers are per user: `invoices_user_number_uq` is `(userId, number)`. */
const INVOICE_NUMBER_RE = /^INV-(\d{4,})$/;

/** The next `INV-nnnn` for one user, given the numbers they already have. */
export function nextInvoiceNumber(existing: readonly string[]): string {
  let highest = 0n;
  for (const value of existing) {
    const match = INVOICE_NUMBER_RE.exec(value);
    const digits = match?.[1];
    if (digits === undefined) continue;
    const parsed = BigInt(digits);
    if (parsed > highest) highest = parsed;
  }
  return formatInvoiceNumber(highest + 1n);
}

/** `7n` → "INV-0007"; widths beyond 4 digits are kept, never truncated. */
export function formatInvoiceNumber(sequence: bigint): string {
  if (sequence <= 0n) throw new RangeError(`Invoice sequence must be positive, got ${sequence}`);
  return `INV-${sequence.toString().padStart(4, "0")}`;
}

export function isInvoiceNumber(value: string): boolean {
  return INVOICE_NUMBER_RE.test(value);
}
