/**
 * The client's copy of the API's read models.
 * Roadmap: S4.1–S4.7 · Spec: ARCHITECTURE.md §3.1
 *
 * These mirror `lib/server/views.ts`, `pay.ts`, `payout.ts`, `receipts.ts`, `demo.ts` and `http.ts`.
 * They are hand-written copies on purpose: those modules import the database and the server config, and a
 * client component must not be able to pull either into the bundle (AGENTS.md §6). If a field changes
 * on the server, the mirror and the route test that pins it change together.
 *
 * Amounts are exact base-unit strings; `amount`/`symbol`/`decimals` are the display half and are
 * `null` when the token list could not be read, which the UI renders as base units rather than a guess.
 */

import type { BaseUnits } from "@/lib/core/types";
import type { DemoOutcome } from "@/lib/core/schemas";
import type { AttemptStatus, InvoiceStatus } from "@/lib/core/status";

export interface MoneyView {
  assetId: string;
  baseUnits: BaseUnits;
  amount: string | null;
  symbol: string | null;
  decimals: number | null;
}

export interface InvoiceLineView {
  description: string;
  quantity: string;
  unitPrice: BaseUnits;
  amount: BaseUnits;
  position: number;
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
  total: MoneyView | null;
  payUrl: string;
  lines: InvoiceLineView[];
}

export interface InvoiceDetail extends InvoiceView {
  attempts: AttemptView[];
}

export interface AttemptView {
  id: string;
  invoiceId: string;
  status: AttemptStatus;
  oneclickStatus: string | null;
  originAsset: MoneyView;
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

export interface MeView {
  nearAccountId: string;
  displayName: string;
  email: string | null;
  isDemo: boolean;
  payout: PayoutView | null;
}

export interface PayoutView {
  assetId: string;
  assetSymbol: string | null;
  decimals: number | null;
  chain: string;
  address: string;
  since: string;
  active: boolean;
  deactivatedAt: string | null;
}

export interface StorageView {
  checked: boolean;
  registered: boolean | null;
  reason: string | null;
  contract: string | null;
  minimumBaseUnits: BaseUnits | null;
  topUpBaseUnits: BaseUnits | null;
}

export interface PayoutChange {
  payout: PayoutView;
  changed: boolean;
  storage: StorageView | null;
}

export interface TokenOption {
  assetId: string;
  symbol: string;
  /** 1Click's short code for the chain, e.g. `arb`. */
  blockchain: string;
  decimals: number;
  refundSupported: boolean;
  /** The chain name `lib/core/address.ts` validates against, or null when it cannot. */
  settleChain: string | null;
}

export interface TokenList {
  assets: TokenOption[];
  payoutAssets: TokenOption[];
}

export interface PublicInvoiceView {
  publicId: string;
  number: string;
  seller: string;
  clientName: string;
  memo: string | null;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string | null;
  paidAt: string | null;
  total: MoneyView | null;
  payUrl: string;
  activeAttempt: AttemptView | null;
  /** True in demo mode: the pay page then offers a simulated deposit instead of a wallet. */
  demo: boolean;
}

/**
 * The demo session (S6.3, S6.4). Mirrors `lib/server/demo.ts`.
 *
 * The invoices are the seeded story, in the order the demo page shows them: one per status the app can
 * reach, so a judge can open the paid one, the short one and the refunded one without waiting.
 */
export interface DemoInvoiceSummary {
  invoiceId: string;
  publicId: string;
  number: string;
  clientName: string;
  status: InvoiceStatus;
  /** In the payout asset; `null` when the token list could not be read. */
  total: MoneyView | null;
  payUrl: string;
  receiptUrl: string | null;
  activeAttempt: AttemptView | null;
  /** Terminal payments on this invoice — 0 for one that was never paid at all. */
  finishedPayments: number;
}

export interface DemoSessionView {
  demo: true;
  /** True when the call had to write the seed; false when the story was already there. */
  seeded: boolean;
  account: { nearAccountId: string; displayName: string; payoutAddress: string };
  invoices: DemoInvoiceSummary[];
}

export interface DemoSimulationView {
  outcome: DemoOutcome;
  /** `null` for `expired`, which is Settle's own deadline rule rather than an upstream status. */
  oneclickStatus: string | null;
  attempt: AttemptView;
  invoiceStatus: InvoiceStatus;
  paid: boolean;
  receiptUrl: string | null;
  /** The outcomes still reachable, so the page offers a next press instead of guessing. */
  next: DemoOutcome[];
}

export interface QuoteView {
  dry: boolean;
  reused: boolean;
  deposit: MoneyView;
  payout: MoneyView;
  feeUsd: string | null;
  deadline: string;
  timeEstimateS: number | null;
  attempt: AttemptView | null;
}

export interface StatusView {
  invoiceStatus: InvoiceStatus;
  attempt: AttemptView | null;
  polled: boolean;
  pollReason: "no_attempt" | "upstream_not_found" | "upstream_unreachable" | null;
  paid: boolean;
  receiptUrl: string | null;
}

export interface SubmitResult {
  attempt: AttemptView;
  forwarded: boolean;
  oneclickStatus: string | null;
}

export interface ReceiptLink {
  hash: string;
  url: string;
}

export interface ReceiptView {
  attemptId: string;
  status: AttemptStatus;
  oneclickStatus: string | null;
  invoice: { number: string; clientName: string; issuedAt: string; dueDate: string | null };
  seller: string;
  sent: MoneyView;
  delivered: MoneyView;
  feeUsd: string | null;
  deposit: { address: string; memo: string | null };
  paidAt: string | null;
  quoteDeadline: string;
  depositTxs: ReceiptLink[];
  deliveryTxs: ReceiptLink[];
  quoteSignature: string;
  receiptUrl: string;
}

export interface SignedIn {
  nearAccountId: string;
  displayName: string;
  isNew: boolean;
}

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "amount_too_low"
  | "upstream_rejected"
  | "upstream_unreachable"
  | "server_misconfigured"
  | "internal_error";

/** `{ path, message }` per rejected field, straight from the request schema. */
export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}
