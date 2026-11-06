/**
 * The line-item table: what was invoiced, and the total it adds up to.
 * Roadmap: S4.3, S4.4, S4.6 · Spec: PRD FR-7, FR-18
 *
 * Line amounts are stored base units in the invoice's own asset, so they are only displayable once
 * the token list has resolved its decimals. When it has not, the exact base units are printed instead
 * of a divided guess — the total the client must pay is never a rounded number.
 */

import type { InvoiceLineView, MoneyView } from "@/lib/api/types";
import type { BaseUnits } from "@/lib/core/types";
import { formatAmount } from "@/lib/core/money";
import { Money } from "@/components/ui/money";

export function LineItems({ lines, total }: { lines: InvoiceLineView[]; total: MoneyView | null }) {
  const decimals = total?.decimals ?? null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Invoice line items</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
            <th scope="col" className="py-2 pr-4 font-medium">Description</th>
            <th scope="col" className="py-2 pr-4 font-medium">Qty</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Unit price</th>
            <th scope="col" className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.position} className="border-b border-line/60 align-top">
              <th scope="row" className="py-2 pr-4 font-normal">
                {line.description}
              </th>
              <td className="py-2 pr-4 text-right">{line.quantity}</td>
              <td className="money py-2 pr-4 text-right">{price(line.unitPrice, decimals)}</td>
              <td className="money py-2 text-right">{price(line.amount, decimals)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="py-3 text-right text-sm font-medium">
              Total
            </td>
            <td className="py-3 text-right">
              {total ? <Money money={total} className="font-semibold" /> : <span className="text-ink-muted">Total unavailable</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function price(baseUnits: BaseUnits, decimals: number | null): string {
  if (decimals === null) return baseUnits;
  return formatAmount(baseUnits, decimals);
}
