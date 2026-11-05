/**
 * Base-unit conversion, formatting, rounding. bigint only — never floats.
 * Roadmap: S1.1 · Spec: AGENTS.md §6, ARCHITECTURE.md §4
 *
 * Amounts arrive as decimal *strings* from HTTP bodies and JSON, and are stored as
 * `numeric(78,0)` base units. All arithmetic here is exact integer arithmetic; the only
 * rounding is half-up where a value cannot be represented in the asset's decimals.
 */

import type { BaseUnits } from "./types";

/** 18 decimals covers every chain we validate; well under Postgres' 78 digits. */
const MAX_DECIMALS = 18;

const DECIMAL_RE = /^\d+(?:\.\d+)?$/;

/** The single place the `BaseUnits` brand is introduced — everything else receives it. */
function baseUnits(value: string): BaseUnits {
  return value as BaseUnits;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`decimals must be an integer from 0 to ${MAX_DECIMALS}, got ${decimals}`);
  }
}

/**
 * Round `numerator / denominator` half-up. Only non-negative numerators: money here is
 * never negative, and half-up on a negative value would round away from zero.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  if (numerator < 0n) throw new RangeError("use signed rounding for negative amounts");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** Split a validated decimal string so both halves are plain `string`, not `string | undefined`. */
function splitDecimal(display: string): { whole: string; fraction: string } {
  const dot = display.indexOf(".");
  if (dot === -1) return { whole: display, fraction: "" };
  return { whole: display.slice(0, dot), fraction: display.slice(dot + 1) };
}

/** `display × 10**decimals`, truncated. Assumes `display` passed the shape check. */
function scaleUp(display: string, decimals: number, round: boolean): BaseUnits {
  assertDecimals(decimals);
  if (!DECIMAL_RE.test(display)) {
    throw new TypeError(`Amount must be a plain decimal string, got "${display}"`);
  }
  const { whole, fraction } = splitDecimal(display);
  const digits = BigInt(whole + fraction);
  const scale = 10n ** BigInt(fraction.length);
  const numerator = digits * 10n ** BigInt(decimals);
  return baseUnits((round ? roundHalfUp(numerator, scale) : numerator / scale).toString());
}

/** "10.5" at 6 decimals → "10500000". Rejects floats, signs, exponent notation and NaN. */
export function toBaseUnits(display: string, decimals: number): BaseUnits {
  return scaleUp(display, decimals, false);
}

/**
 * "10.5001" at 6 decimals is exact; "0.0000005" at 6 decimals becomes "0.000001" rather
 * than silently vanishing. Rounding up a sub-minimum amount is the caller's problem —
 * see the minimum-invoice task (#64).
 */
export function toBaseUnitsRounded(display: string, decimals: number): BaseUnits {
  return scaleUp(display, decimals, true);
}

/** Exact decimal string, trailing zeros trimmed: "10500000" at 6 → "10.5". */
export function fromBaseUnits(amount: BaseUnits, decimals: number): string {
  assertDecimals(decimals);
  const value = BigInt(parseBaseUnits(amount));
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString();
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** Grouped for humans, exact to the last base unit: "1,234.5678". */
export function formatAmount(amount: BaseUnits, decimals: number): string {
  const text = fromBaseUnits(amount, decimals);
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? "" : text.slice(dot + 1);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === "" ? grouped : `${grouped}.${fraction}`;
}

/** Sum of base-unit amounts. Empty is 0, not null — an invoice with no lines is invalid elsewhere. */
export function sumAmounts(amounts: readonly BaseUnits[]): BaseUnits {
  return baseUnits(amounts.reduce((total, part) => total + BigInt(part), 0n).toString());
}

/** True when a base-unit string is a non-negative integer, for zod validation at the boundary. */
export function isBaseUnitsString(value: string): boolean {
  return /^\d+$/.test(value);
}

/** Check then brand an already-integer string. Use this instead of casting at call sites. */
export function parseBaseUnits(value: string): BaseUnits {
  if (!isBaseUnitsString(value)) {
    throw new TypeError(`Base-unit amount must be a non-negative integer string, got "${value}"`);
  }
  return baseUnits(value);
}
