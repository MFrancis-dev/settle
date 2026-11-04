/**
 * zod schemas for API request bodies.
 * Roadmap: S1.6 · Spec: ARCHITECTURE.md §3.1
 * Status: scaffold — not implemented yet.
 */

import { z } from "zod";

export const payoutInput = z.object({
  assetId: z.string().min(1),
  chain: z.string().min(1),
  address: z.string().min(1),
  addressConfirm: z.string().min(1),
});

export const invoiceLineInput = z.object({
  description: z.string().min(1).max(200),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitPrice: z.string().regex(/^\d+$/),
});

export const createInvoiceInput = z.object({
  clientName: z.string().min(1).max(120),
  clientEmail: z.string().email().optional(),
  memo: z.string().max(500).optional(),
  dueDate: z.string().date().optional(),
  items: z.array(invoiceLineInput).min(1).max(50),
});

export const payQuoteInput = z.object({
  originAsset: z.string().min(1),
  refundTo: z.string().min(1),
  dry: z.boolean(),
});
