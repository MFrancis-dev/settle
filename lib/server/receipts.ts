/**
 * `GET /api/receipts/:attemptId` — the receipt a client and a freelancer both keep (PRD FR-18).
 * Roadmap: S3.7 · Spec: ARCHITECTURE.md §3.1, §4, §6
 *
 * Authorisation is the token in the link: whoever paid is entitled to the proof, and `receipt_token`
 * is unique and unguessable, so the URL is the credential. A wrong id and a wrong token answer the
 * same 404 — neither may be used to probe which attempts exist.
 *
 * The figures are the *stored quote* (what was promised, signed) plus the *status payload 1Click sent
 * back* (what actually moved). Re-parsing that payload through the same zod schema the client uses is
 * what keeps this read honest instead of trusting a `jsonb` column.
 */

import { executionStatusSchema } from "../oneclick/status";
import { isUuid } from "../core/ids";
import { findAttemptById } from "../db/queries/paymentAttempts";
import { getInvoiceById } from "../db/queries/invoices";
import { findDestinationById } from "../db/queries/payoutDestinations";
import { findUserById } from "../db/queries/users";
import { notFound } from "./http";
import { moneyView, receiptUrlFor, type MoneyView } from "./views";
import type { AttemptStatus } from "../core/status";
import type { ServerDeps } from "./deps";

export interface ReceiptLink {
  hash: string;
  url: string;
}

export interface ReceiptView {
  attemptId: string;
  status: AttemptStatus;
  oneclickStatus: string | null;
  invoice: { number: string; clientName: string; issuedAt: string; dueDate: string | null };
  /** The seller's own display name — the payer needs to know who they paid. */
  seller: string;
  sent: MoneyView;
  delivered: MoneyView;
  feeUsd: string | null;
  deposit: { address: string; memo: string | null };
  /** When the money arrived: the last status write for a settled attempt (§4). */
  paidAt: string | null;
  quoteDeadline: string;
  depositTxs: ReceiptLink[];
  deliveryTxs: ReceiptLink[];
  /** The service's attestation over this quote (§3.2) — the number a dispute starts from. */
  quoteSignature: string;
  receiptUrl: string;
}

function links(
  entries: readonly { hash: string; explorerUrl: string }[],
  fallbackHashes: readonly string[],
): ReceiptLink[] {
  if (entries.length > 0) return entries.map((entry) => ({ hash: entry.hash, url: entry.explorerUrl }));
  return fallbackHashes.map((hash) => ({ hash, url: "" }));
}

/**
 * The receipt for one attempt.
 *
 * `refundTo` is deliberately absent: a receipt is shared, and the payer's own address is not
 * information the document needs.
 */
export async function receipt(
  deps: ServerDeps,
  attemptId: string,
  token: string,
): Promise<ReceiptView> {
  // An id that is not a uuid cannot match a row, and Postgres answers the read with an error.
  if (!isUuid(attemptId)) throw notFound("No such receipt.");
  const attempt = await findAttemptById(deps.db, attemptId);
  if (!attempt || attempt.receiptToken === null || attempt.receiptToken !== token) {
    throw notFound("No such receipt.");
  }

  const invoice = await getInvoiceById(deps.db, attempt.invoiceId);
  if (!invoice) throw notFound("No such receipt.");

  const [destination, seller] = await Promise.all([
    findDestinationById(deps.db, attempt.payoutDestinationId),
    findUserById(deps.db, invoice.userId),
  ]);

  // `status_raw` is whatever 1Click last said; anything unparsable means "no links", not a crash.
  const status = executionStatusSchema.safeParse(attempt.statusRaw);
  const swap = status.success ? status.data.swapDetails : null;
  const depositHashes = attempt.depositTxHash ? [attempt.depositTxHash] : [];
  const deliveryHashes = attempt.deliveryTxHash ? [attempt.deliveryTxHash] : [];

  return {
    attemptId: attempt.id,
    status: attempt.status,
    oneclickStatus: attempt.oneclickStatus,
    invoice: {
      number: invoice.number,
      clientName: invoice.clientName,
      issuedAt: invoice.createdAt.toISOString(),
      dueDate: invoice.dueDate,
    },
    seller: seller?.displayName ?? "Settle seller",
    sent: await moneyView(deps, attempt.originAsset, attempt.amountIn),
    delivered: await moneyView(deps, destination?.assetId ?? attempt.originAsset, attempt.amountOut),
    feeUsd: attempt.feeUsd,
    deposit: { address: attempt.depositAddress, memo: attempt.depositMemo },
    paidAt: attempt.status === "success" ? attempt.updatedAt.toISOString() : null,
    quoteDeadline: attempt.quoteDeadline.toISOString(),
    depositTxs: links(swap?.originChainTxHashes ?? [], depositHashes),
    deliveryTxs: links(swap?.destinationChainTxHashes ?? [], deliveryHashes),
    quoteSignature: attempt.quoteSignature,
    receiptUrl: receiptUrlFor(deps, attempt.receiptToken, attempt.id),
  };
}
