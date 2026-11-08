"use client";

/**
 * The landing's one live thing (design pass, S4.10): the client's token choice, blown up to poster
 * size and made to work. Picking a token swaps the deposit amount for a fixed $1,500 invoice, exactly
 * as the real pay page does — the rates here are illustrative and add up, not a live quote.
 */

import { useState } from "react";

const INVOICE_USD = 1500;
const FEE_USD = 2.2;

interface DemoToken {
  symbol: string;
  chain: string;
  /** USD per one unit of this token. Illustrative, fixed, and chosen so the figures add up. */
  priceUsd: number;
  time: string;
}

const TOKENS: DemoToken[] = [
  { symbol: "USDC", chain: "Arbitrum", priceUsd: 1, time: "a few minutes" },
  { symbol: "USDT", chain: "Ethereum", priceUsd: 1, time: "a few minutes" },
  { symbol: "wNEAR", chain: "NEAR", priceUsd: 5, time: "a few minutes" },
];

function usd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function amount(token: DemoToken): string {
  const units = INVOICE_USD / token.priceUsd;
  return `${units.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${token.symbol}`;
}

export function TokenPickerDemo() {
  const [chosen, setChosen] = useState(0);
  const token = TOKENS[chosen]!;

  return (
    <div data-ui className="w-full">
      <p className="text-sm text-ink-muted">
        They pay in <span className="font-medium text-ink">{token.symbol}</span>
      </p>

      <div
        role="radiogroup"
        aria-label="Choose the token to pay with"
        className="mt-3 flex flex-col gap-2"
      >
        {TOKENS.map((t, i) => {
          const selected = i === chosen;
          return (
            <button
              key={t.symbol}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setChosen(i)}
              className={`flex items-center justify-between rounded-card border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-ink bg-surface-sunk"
                  : "border-line bg-surface hover:border-line-strong"
              }`}
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    selected ? "border-ink" : "border-line-strong"
                  }`}
                >
                  {selected ? <span className="h-2 w-2 rounded-full bg-ink" /> : null}
                </span>
                <span>
                  <span className="block text-sm font-medium">{t.symbol}</span>
                  <span className="block text-xs text-ink-faint">{t.chain}</span>
                </span>
              </span>
              <span className="money text-sm font-semibold">{amount(t)}</span>
            </button>
          );
        })}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line">
        <div className="bg-surface p-4">
          <dt className="text-xs text-ink-faint">They pay</dt>
          <dd className="money mt-1 text-lg font-bold">{amount(token)}</dd>
          <dd className="mt-0.5 text-xs text-ink-muted">settles in {token.time}</dd>
        </div>
        <div className="bg-surface p-4">
          <dt className="text-xs text-ink-faint">You receive</dt>
          <dd className="money mt-1 text-lg font-bold">${usd(INVOICE_USD - FEE_USD)}</dd>
          <dd className="mt-0.5 text-xs text-ink-muted">fee ${usd(FEE_USD)}</dd>
        </div>
      </dl>
    </div>
  );
}
