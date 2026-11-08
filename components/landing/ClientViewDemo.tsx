"use client";

/**
 * The landing's "what the client sees" (design pass, S4.10): a believable crop of the real pay page —
 * the token list, the refund address, the quote — and the deposit panel with a live QR of a sample
 * address. Two interface fragments; nothing here moves money.
 */

import { QRCodeSVG } from "qrcode.react";

const SAMPLE_ADDRESS = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";

function Row({
  symbol,
  chain,
  amount,
  selected = false,
}: {
  symbol: string;
  chain: string;
  amount: string;
  selected?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-control border px-3 py-2.5 ${
        selected ? "border-ink bg-surface-sunk" : "border-line bg-surface"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
            selected ? "border-ink" : "border-line-strong"
          }`}
        >
          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-ink" /> : null}
        </span>
        <span className="text-sm font-medium">{symbol}</span>
        <span className="text-xs text-ink-faint">{chain}</span>
      </span>
      <span className="money text-sm font-semibold">{amount}</span>
    </div>
  );
}

export function ClientViewDemo() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* The pay page */}
      <div data-ui className="rounded-card bg-surface p-5">
        <p className="text-base font-medium">Choose how you want to pay</p>
        <div className="mt-3 flex flex-col gap-2">
          <Row symbol="USDC" chain="Arbitrum" amount="1,500.00" selected />
          <Row symbol="USDT" chain="Ethereum" amount="1,500.00" />
          <Row symbol="wNEAR" chain="NEAR" amount="300.00" />
        </div>
        <div className="mt-3">
          <p className="text-xs text-ink-faint">Refund address, if anything goes wrong</p>
          <div className="mt-1 rounded-control bg-surface-sunk px-3 py-2 text-sm text-ink-muted">
            client.demo.near
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-control bg-line text-center">
          <div className="bg-surface px-2 py-2">
            <dt className="text-[11px] text-ink-faint">They pay</dt>
            <dd className="money mt-0.5 text-sm font-semibold">1,500.00</dd>
          </div>
          <div className="bg-surface px-2 py-2">
            <dt className="text-[11px] text-ink-faint">Fee</dt>
            <dd className="money mt-0.5 text-sm font-semibold">$2.20</dd>
          </div>
          <div className="bg-surface px-2 py-2">
            <dt className="text-[11px] text-ink-faint">You receive</dt>
            <dd className="money mt-0.5 text-sm font-semibold">$1,497.80</dd>
          </div>
        </dl>
        <div className="mt-3 rounded-control bg-ink px-4 py-2.5 text-center text-sm font-medium text-ink-invert">
          Get a payment address
        </div>
      </div>

      {/* The deposit panel */}
      <div data-ui className="flex flex-col rounded-card bg-surface p-5">
        <p className="text-base font-medium">Send exactly</p>
        <p className="money mt-1 text-2xl font-bold">1,500.00 USDC</p>
        <div className="mt-4 flex items-start gap-4">
          <div className="shrink-0 rounded-control bg-surface-sunk p-2">
            <QRCodeSVG value={SAMPLE_ADDRESS} size={120} level="M" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-ink-faint">To this address</p>
            <p className="mt-1 break-all text-sm text-ink-muted">{SAMPLE_ADDRESS}</p>
            <p className="mt-3 text-xs text-ink-faint">Quote expires in</p>
            <p className="money mt-0.5 text-sm font-semibold">4:59</p>
          </div>
        </div>
        <p className="mt-auto pt-4 text-sm text-ink-muted">
          The amount is fixed for a few minutes, then re-quoted — nobody pays against an old price.
        </p>
      </div>
    </div>
  );
}
