"use client";

/**
 * "Pay with" — the list of tokens the client's own wallet can send.
 * Roadmap: S4.4 · Spec: PRD FR-12, FR-13
 *
 * Radio inputs styled as rows, not a dropdown: the choice is between a handful of things the person
 * already owns, and seeing the network next to each token is what stops them sending from the wrong
 * one. Tokens Settle cannot refund to are left out, because the server would refuse them anyway.
 */

import { useMemo, useState } from "react";

import type { TokenOption } from "@/lib/api/types";
import { chainLabel } from "@/lib/ui/chain";

export function TokenPicker({
  tokens,
  value,
  onChange,
}: {
  tokens: TokenOption[];
  value: string;
  onChange: (assetId: string) => void;
}) {
  const [query, setQuery] = useState("");

  // Stable order: the networks a person can refund to, then symbol.
  const shown = useMemo(() => {
    const search = query.trim().toLowerCase();
    return tokens
      .filter((token) => token.refundSupported)
      .filter((token) => search === "" || token.symbol.toLowerCase().includes(search) || chainLabel(token.settleChain ?? token.blockchain).toLowerCase().includes(search))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [tokens, query]);

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">Pay with</legend>
      <p className="mt-1 text-xs text-ink-muted">
        Pick a token your wallet already holds. Settle converts it; nothing is swapped inside Settle.
      </p>

      <label className="sr-only" htmlFor="token-search">
        Filter tokens by name
      </label>
      <input
        id="token-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search USDC, USDT, DAI…"
        className="mt-3 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm"
      />

      <ul className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {shown.map((token) => {
          const chain = token.settleChain ?? token.blockchain;
          const id = `token-${token.assetId.replace(/[^a-zA-Z0-9]/g, "-")}`;
          return (
            <li key={token.assetId}>
              <label
                htmlFor={id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-card border px-3 py-2.5 text-sm ${
                  value === token.assetId ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-sunk"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    id={id}
                    type="radio"
                    name="origin-asset"
                    checked={value === token.assetId}
                    onChange={() => onChange(token.assetId)}
                    className="h-4 w-4 accent-brand"
                  />
                  <span className="font-medium">{token.symbol}</span>
                </span>
                <span className="text-xs text-ink-muted">{chainLabel(chain)}</span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="text-sm text-ink-muted">No listed token matches that search.</li>
        ) : null}
      </ul>
    </fieldset>
  );
}
