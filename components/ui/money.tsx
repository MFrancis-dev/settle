/**
 * The one way an amount is drawn.
 * Roadmap: S4.3–S4.7 · Spec: AGENTS.md §6
 *
 * Amounts arrive as an exact base-unit string plus, when the token list could be read, the display
 * half. When it could not, the exact base units are shown and labelled — the alternative is a number
 * that looks like a guess, and a pay page may never show one.
 */

import type { MoneyView } from "@/lib/api/types";
import { UNRESOLVED_ASSET, moneyText, moneyTextRounded } from "@/lib/ui/money-text";

export function Money({
  money,
  places,
  className = "",
}: {
  money: MoneyView;
  /** Cut (never round) the displayed fraction to this many digits. */
  places?: number;
  className?: string;
}) {
  const unresolved = money.amount === null;
  const value = places === undefined ? moneyText(money) : moneyTextRounded(money, places);

  return (
    <span className={`money inline-flex min-w-0 items-baseline gap-1 ${className}`}>
      <span className={`min-w-0 [overflow-wrap:anywhere] ${unresolved ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
      {money.symbol ? <span className="text-ink-muted">{money.symbol}</span> : null}
      {unresolved ? <span className="text-xs text-ink-faint">{UNRESOLVED_ASSET}</span> : null}
    </span>
  );
}

/** The exact base-unit line, for anything that may be checked against a block explorer. */
export function MoneyExact({ money }: { money: MoneyView }) {
  return (
    <p className="text-xs text-ink-faint">
      <span className="font-mono">{money.baseUnits}</span> base units
      {money.decimals !== null ? ` · ${money.decimals} decimals` : ""}
    </p>
  );
}
