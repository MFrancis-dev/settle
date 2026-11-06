/**
 * Display text for the amounts that travel as exact base-unit strings.
 * Roadmap: S4.3–S4.7 · Spec: AGENTS.md §6 (never a float for money)
 *
 * The server already resolves `amount`/`symbol`/`decimals` from the live token list; when the list
 * could not be read those are `null`, and this shows the exact base units with a label instead of
 * inventing a number. Nothing here does arithmetic.
 */

import type { MoneyView } from "@/lib/api/types";

/** Thousands-grouped decimal text: "1234.5" → "1,234.5". No rounding. */
export function groupDecimal(text: string): string {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? "" : body.slice(dot);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction}`;
}

/** A money row's headline number, grouped, with the symbol kept out of it so it stays selectable. */
export function moneyText(money: MoneyView): string {
  return money.amount === null ? groupDecimal(money.baseUnits) : groupDecimal(money.amount);
}

/**
 * How many digits to show. A token with 24 decimals is never shown to 24 places; the exact value
 * stays available through `moneyText` and the base-unit line underneath.
 */
export function moneyTextRounded(money: MoneyView, places: number): string {
  if (money.amount === null) return groupDecimal(money.baseUnits);
  const dot = money.amount.indexOf(".");
  if (dot === -1) return groupDecimal(money.amount);
  const fraction = money.amount.slice(dot + 1);
  if (fraction.length <= places) return groupDecimal(money.amount);
  // Truncate rather than round: a rounded-up display can read as "enough" when it is not.
  return groupDecimal(`${money.amount.slice(0, dot + 1 + places)}…`);
}

/** True when the number is exact-and-known, so the caller can decide whether to show "≈". */
export function moneyIsExact(money: MoneyView): boolean {
  return money.amount !== null;
}

/** The sentence a screen shows when it cannot resolve a token. */
export const UNRESOLVED_ASSET = "shown in its smallest unit — this token is not in the live list";

/** The dollar estimate 1Click reports for a quote. Display only, never a ledger amount. */
export function usdText(feeUsd: string | null): string | null {
  if (feeUsd === null) return null;
  const [whole, fraction] = feeUsd.split(".");
  const cents = (fraction ?? "").padEnd(2, "0").slice(0, 2);
  return `$${groupDecimal(whole ?? "0")}.${cents}`;
}
