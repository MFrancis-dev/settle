/**
 * The landing hero's picture (design pass, S4.10): the receipt — Settle's actual output. A ruled,
 * printable-looking document with figures that add up, and the single brand green reserved for the
 * money that has arrived. Server-rendered; it is an illustration, not live data.
 */

import { Mark } from "@/components/ui/mark";

export function ReceiptDemo() {
  return (
    <div
      data-ui
      className="rounded-card bg-surface p-6 sm:p-7"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Mark />
          Settle
        </span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
          Settled
        </span>
      </div>

      <div className="mt-5 border-t border-line pt-5">
        <p className="text-xs text-ink-faint">Invoice</p>
        <p className="money mt-0.5 text-sm font-semibold">#INV-0001</p>
        <p className="mt-0.5 text-xs text-ink-muted">Design work, 3 days · for Ada</p>
      </div>

      <dl className="mt-5 space-y-2 border-t border-line pt-5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">They paid</dt>
          <dd className="money font-semibold">1,500.00 USDC</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Conversion fee</dt>
          <dd className="money">$2.20</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-2">
          <dt className="font-medium">You received</dt>
          <dd className="money text-lg font-bold text-brand">$1,497.80</dd>
        </div>
      </dl>

      <p className="mt-5 border-t border-line pt-4 text-xs text-ink-faint">
        USDC on Arbitrum · every step is a transaction you can look up
      </p>
    </div>
  );
}
