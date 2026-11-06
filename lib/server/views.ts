/**
 * Read models: what a database row looks like over HTTP.
 * Roadmap: S3.3, S3.4, S3.6, S3.7 · Spec: ARCHITECTURE.md §3.1, §6
 *
 * Kept in one place because the same rows appear in the freelancer's dashboard, the client's pay
 * page, the invoice detail, the receipt and the CSV — and the §6 rule ("minimal public data") is a
 * property of *these* shapes, so it has to be reviewable in one file rather than spread over routes.
 * Amounts always travel as exact base-unit strings; the display fields are resolved from the live
 * token list and are `null` when it cannot be read (AGENTS.md §6: never show an estimated unit).
 */

import { fromBaseUnits } from "../core/money";
import type { BaseUnits } from "../core/types";
import type { InvoiceStatus, AttemptStatus } from "../core/status";
import type { InvoiceRecord } from "../db/queries/invoices";
import type { PaymentAttemptRecord } from "../db/queries/paymentAttempts";
import { findDestinationById } from "../db/queries/payoutDestinations";
import type { Asset } from "../core/types";
import type { ServerDeps } from "./deps";

/** Display metadata is best-effort: an unreachable token list costs formatting, never correctness. */
async function asset(deps: ServerDeps, assetId: string): Promise<Asset | null> {
  try {
    return await deps.tokens.find(assetId);
  } catch {
    return null;
  }
}

export interface MoneyView {
  assetId: string;
  /** Exact integer in the asset's smallest unit; this is what the amounts are checked against. */
  baseUnits: BaseUnits;
  /** `null` when the asset is not in the token list, so the UI shows base units rather than a guess. */
  amount: string | null;
  symbol: string | null;
  decimals: number | null;
}

export async function moneyView(
  deps: ServerDeps,
  assetId: string,
  baseUnits: BaseUnits,
): Promise<MoneyView> {
  const found = await asset(deps, assetId);
  return {
    assetId,
    baseUnits,
    amount: found ? fromBaseUnits(baseUnits, found.decimals) : null,
    symbol: found?.symbol ?? null,
    decimals: found?.decimals ?? null,
  };
}

export interface InvoiceView {
  id: string;
  publicId: string;
  number: string;
  status: InvoiceStatus;
  clientName: string;
  clientEmail: string | null;
  memo: string | null;
  dueDate: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** In the invoice's payout asset — the number 1Click is asked to deliver exactly. */
  total: MoneyView | null;
  /** Absolute pay-page URL, built from `PUBLIC_APP_URL` so a copy-paste works anywhere. */
  payUrl: string;
  lines: {
    description: string;
    quantity: string;
    unitPrice: BaseUnits;
    amount: BaseUnits;
    position: number;
  }[];
}

/**
 * `payoutAssetId` comes from the snapshot on the attempt when there is one, and from the seller's
 * current destination otherwise: an unpaid invoice's total is still denominated in whatever the
 * freelancer is asking to be paid in today.
 */
export async function invoiceView(
  deps: ServerDeps,
  invoice: InvoiceRecord,
  payoutAssetId: string | null,
): Promise<InvoiceView> {
  return {
    id: invoice.id,
    publicId: invoice.publicId,
    number: invoice.number,
    status: invoice.status,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    memo: invoice.memo,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    total: payoutAssetId ? await moneyView(deps, payoutAssetId, invoice.total) : null,
    payUrl: payUrlFor(deps, invoice.publicId),
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      position: line.position,
    })),
  };
}

export interface AttemptView {
  id: string;
  invoiceId: string;
  status: AttemptStatus;
  oneclickStatus: string | null;
  /** What the client sends, including the slippage buffer (`amountIn`). */
  originAsset: MoneyView;
  /** The fixed side of the quote: what the freelancer receives (`amountOut`). */
  payoutAsset: MoneyView;
  depositAddress: string;
  depositMemo: string | null;
  feeUsd: string | null;
  quoteDeadline: string;
  depositTxHash: string | null;
  deliveryTxHash: string | null;
  createdAt: string;
  updatedAt: string;
  receiptUrl: string | null;
}

/**
 * One quote, as the client and the dashboard see it.
 *
 * The freelancer's payout *address* is deliberately absent: a pay page needs the deposit address and
 * the amounts, and §6 says the rest stays private. `refundTo` is the client's own address, so it is
 * returned by the routes that authenticated the client's request — never by a public read.
 */
export async function attemptView(deps: ServerDeps, row: PaymentAttemptRecord): Promise<AttemptView> {
  const destination = await findDestinationById(deps.db, row.payoutDestinationId);

  return {
    id: row.id,
    invoiceId: row.invoiceId,
    status: row.status,
    oneclickStatus: row.oneclickStatus,
    originAsset: await moneyView(deps, row.originAsset, row.amountIn),
    payoutAsset: await moneyView(deps, destination?.assetId ?? row.originAsset, row.amountOut),
    depositAddress: row.depositAddress,
    depositMemo: row.depositMemo,
    feeUsd: row.feeUsd,
    quoteDeadline: row.quoteDeadline.toISOString(),
    depositTxHash: row.depositTxHash,
    deliveryTxHash: row.deliveryTxHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    receiptUrl: row.receiptToken ? receiptUrlFor(deps, row.receiptToken, row.id) : null,
  };
}

/**
 * A receipt link, with both halves of its authorisation in it.
 *
 * The token is the secret and the attempt id is the row it opens: `GET /api/receipts/:attemptId`
 * needs the id to find the attempt at all, so a URL without `?attempt=` renders a page that can only
 * say "this link is incomplete". Every link the app hands out is built here, which is why the id is
 * a required argument rather than an optional one.
 */
export function receiptUrlFor(deps: ServerDeps, receiptToken: string, attemptId: string): string {
  const origin = deps.appUrl.replace(/\/+$/, "");
  return `${origin}/receipt/${receiptToken}?attempt=${attemptId}`;
}

export function payUrlFor(deps: ServerDeps, publicId: string): string {
  return `${deps.appUrl.replace(/\/+$/, "")}/pay/${publicId}`;
}
