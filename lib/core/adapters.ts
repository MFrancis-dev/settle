/**
 * Interfaces swapped between real (1Click) and demo implementations.
 * Roadmap: S1.5 · Spec: ARCHITECTURE.md §7
 * Status: scaffold — not implemented yet.
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
  invoiceQuote(input: InvoiceQuoteInput, opts: { dry: boolean }): Promise<QuoteSummary>;
}

export interface StatusProvider {
  getStatus(depositAddress: string): Promise<{ status: OneClickStatus; raw: unknown }>;
  submitDepositTx(depositAddress: string, txHash: string): Promise<void>;
}
