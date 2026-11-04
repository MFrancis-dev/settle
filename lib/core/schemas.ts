/**
 * zod schemas for every API request body — the boundary between HTTP and the pure core.
 * Roadmap: S1.6 · Spec: ARCHITECTURE.md §3.1
 *
 * Amounts are checked as base-unit strings here, and addresses through `address.ts`, so no
 * route has to re-implement either. Inference is the only source of request types.
 */

import { z } from "zod";

import { validateAddress } from "./address";
import { isBaseUnitsString } from "./money";

/** Non-negative integer in an asset's smallest unit: "25000000" is 25 USDC at 6 decimals. */
export const baseUnitsSchema = z
  .string()
  .refine(isBaseUnitsString, { message: "Amount must be a non-negative integer string" });

/** Quantities carry at most 4 decimal places, matching `numeric(18,4)`. */
export const quantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Quantity has at most 4 decimal places");

export const invoiceLineInput = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: quantitySchema,
  unitPrice: baseUnitsSchema,
});

export const createInvoiceInput = z.object({
  clientName: z.string().trim().min(1).max(120),
  clientEmail: z.string().trim().email().optional(),
  memo: z.string().trim().max(500).optional(),
  dueDate: z.string().date().optional(),
  items: z.array(invoiceLineInput).min(1).max(50),
});

/** Setting or changing a payout needs a fresh NEP-413 signature and the address typed twice. */
export const payoutInput = z
  .object({
    assetId: z.string().trim().min(1).max(200),
    chain: z.string().trim().min(1).max(40),
    address: z.string().trim().min(1).max(255),
    addressConfirm: z.string().trim().min(1).max(255),
    signature: z.string().min(1).max(200),
    publicKey: z.string().min(1).max(200),
    nonce: z.string().min(1).max(200),
  })
  .superRefine((data, ctx) => {
    if (data.address !== data.addressConfirm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["addressConfirm"],
        message: "The two addresses must match",
      });
    }
    const checked = validateAddress(data.chain, data.address);
    if (!checked.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["address"],
        message: checked.reason,
      });
    }
  });

/**
 * `refundTo` is on the origin chain, which `originAsset` only names once the token list is
 * resolved, so the shape check happens in the route that has that list (S3.5).
 */
export const payQuoteInput = z.object({
  originAsset: z.string().trim().min(1).max(200),
  refundTo: z.string().trim().min(1).max(255),
  dry: z.boolean(),
});

export const submitTxInput = z.object({
  txHash: z.string().trim().min(1).max(255),
});

/** NEP-413 sign-in body; the fields wallet-selector returns from `signMessage`. */
export const signInInput = z.object({
  /** base64 signature over `message`. */
  signature: z.string().min(1).max(200),
  /** "ed25519:<base64 public key>". */
  publicKey: z.string().min(1).max(200),
  /** base64 of the nonce we issued, so replay is detectable. */
  nonce: z.string().min(1).max(200),
  accountId: z.string().trim().min(2).max(64),
});

export const demoActionInput = z.enum(["simulate-payment", "reset"]);

export type CreateInvoiceInput = z.infer<typeof createInvoiceInput>;
export type PayoutInput = z.infer<typeof payoutInput>;
export type PayQuoteInput = z.infer<typeof payQuoteInput>;
export type SubmitTxInput = z.infer<typeof submitTxInput>;
export type SignInInput = z.infer<typeof signInInput>;
export type DemoAction = z.infer<typeof demoActionInput>;
