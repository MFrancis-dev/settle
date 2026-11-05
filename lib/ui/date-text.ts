/**
 * Date text for the screens: a day for lists, a day and time for anything a person may be charged
 * against (a quote deadline, a payout change, a receipt).
 * Roadmap: S4.3–S4.7 · Spec: PRD §7
 *
 * The browser's locale decides the order; the year is always shown, because invoices outlive months
 * and "12 Mar" is not a due date a client can act on.
 */

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const MOMENT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function parsed(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateText(iso: string | null): string {
  if (iso === null) return "—";
  const date = parsed(iso);
  return date === null ? "—" : DAY.format(date);
}

/** Falls back to the raw string when it is not a timestamp the runtime can read. */
export function dateTimeText(iso: string | null): string {
  if (iso === null) return "—";
  const date = parsed(iso);
  return date === null ? String(iso) : MOMENT.format(date);
}

/** "in 4 min" / "9 min ago" — the countdown text a quote deadline needs alongside the clock. */
export function relativeMinutes(iso: string, now: number = Date.now()): string | null {
  const date = parsed(iso);
  if (date === null) return null;
  const seconds = Math.round((date.getTime() - now) / 1000);
  const future = seconds >= 0;
  const absolute = Math.abs(seconds);
  if (absolute < 60) return future ? "less than a minute" : "just now";
  const minutes = Math.floor(absolute / 60);
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  return future ? `in ${Math.floor(hours / 24)} days` : `${Math.floor(hours / 24)} days ago`;
}
