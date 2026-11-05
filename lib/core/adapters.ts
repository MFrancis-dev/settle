/**
 * Interfaces swapped between real (1Click) and demo implementations.
 * Roadmap: S1.5 · Spec: ARCHITECTURE.md §7
 *
 * `lib/server/adapters.ts` picks the implementation from the session type, so nothing above
 * it branches on demo vs real. `dry` is a request flag, not a mode: a dry quote is a preview
 * from the real API and is never stored.
 */

import type { OneClickStatus } from "./status";
import type { AssetId, BaseUnits, PayoutDestination, QuoteSummary } from "./types";

export interface InvoiceQuoteInput {
  originAsset: AssetId;
  refundTo: string;
  payout: PayoutDestination;
  amountOut: BaseUnits;
  deadline: string;
}

export interface QuoteProvider {
  /** Build a quote for an invoice. `dry: true` is a preview and is never persisted. */
  invoiceQuote(input: InvoiceQuoteInput, opts: { dry: boolean }): Promise<QuoteSummary>;
}

export interface StatusProvider {
  /** Poll the payment status for one deposit address. `raw` is kept verbatim for receipts. */
  getStatus(depositAddress: string): Promise<{ status: OneClickStatus; raw: unknown }>;
  /** Tell the provider a deposit tx exists, so it can stop waiting for one. */
  submitDepositTx(depositAddress: string, txHash: string): Promise<void>;
}
