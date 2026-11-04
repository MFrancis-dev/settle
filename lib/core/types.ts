/**
 * Domain types shared by server, worker and UI. Pure — no I/O.
 * Roadmap: S1.x · Spec: ARCHITECTURE.md §3–4
 * Status: scaffold — not implemented yet.
 */

/** Amount in an asset's smallest unit, as a decimal string. Never a float. */
export type BaseUnits = string & { readonly __brand: "BaseUnits" };

/** 1Click asset id, e.g. "nep141:wrap.near". Always resolved from /v0/tokens. */
export type AssetId = string;

export interface Asset {
  assetId: AssetId;
  symbol: string;
  blockchain: string;
  decimals: number;
}

/** Where a freelancer is paid. Snapshotted on every payment attempt. */
export interface PayoutDestination {
  assetId: AssetId;
  chain: string;
  address: string;
}

export interface InvoiceLineInput {
  description: string;
  /** Decimal string, up to 4 places. */
  quantity: string;
  unitPrice: BaseUnits;
}

/** What we keep from a verified 1Click quote. */
export interface QuoteSummary {
  dry: boolean;
  depositAddress: string | null;
  depositMemo: string | null;
  amountIn: BaseUnits;
  amountOut: BaseUnits;
  feeUsd: string | null;
  deadline: string;
  timeEstimateS: number | null;
  signature: string;
  raw: unknown;
}
