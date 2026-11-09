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
import { INVOICE_STATUSES } from "./status";

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

/**
 * The fields a wallet signs in the published NEP-413 shape — the one `wallet.signMessage()` returns.
 *
 * `verifyNep413SignedMessage` rebuilds the Borsh payload from these fields and checks the signature
 * over it, so every field that is inside the payload has to travel: a body copy of `recipient` or
 * `callbackUrl` would be an unsigned second source of truth. The nonce is base64 of the 32 random
 * bytes, which the standard fixes at exactly 32.
 *
 * `signedMessage` is an *object schema* on purpose: `.extend()` below builds request bodies from it,
 * and a helper typed `z.ZodType<T>` would be a different, incompatible class.
 */
export const signedMessage = z.object({
  /** The text shown in the wallet's dialog. */
  message: z.string().min(1).max(4096),
  /** This app's host; a signature made for another site is refused. */
  recipient: z.string().min(1).max(64),
  /** base64 of the 32 random bytes that were signed. */
  nonce: z.string().min(1).max(64),
  /** Absent means the wallet signed `None`; an empty string is a *different* payload. */
  callbackUrl: z.string().min(1).max(2048).optional(),
  /** base64 of the 64-byte signature. */
  signature: z.string().min(1).max(128),
  /** "ed25519:<base58 public key>". */
  publicKey: z.string().startsWith("ed25519:"),
});

/**
 * The same fields as a `ZodType`, for pulling them out of an already-parsed request body.
 * Not `strict()`: sign-in adds `accountId` and a payout adds the address, and those belong to the
 * route. `verifyNep413SignedMessage` gets exactly the signed set, so the extra fields cannot reach
 * the signature check.
 */
export const signedMessageFields = z.object({
  message: signedMessage.shape.message,
  recipient: signedMessage.shape.recipient,
  nonce: signedMessage.shape.nonce,
  callbackUrl: signedMessage.shape.callbackUrl,
  signature: signedMessage.shape.signature,
  publicKey: signedMessage.shape.publicKey,
});

export type SignedMessageFields = z.infer<typeof signedMessageFields>;

/** Setting or changing a payout needs a fresh NEP-413 signature and the address typed twice. */
export const payoutInput = signedMessage
  .extend({
    assetId: z.string().trim().min(1).max(200),
    chain: z.string().trim().min(1).max(40),
    address: z.string().trim().min(1).max(255),
    addressConfirm: z.string().trim().min(1).max(255),
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

/** NEP-413 sign-in body: the signed message plus the account that signed it. */
export const signInInput = signedMessage.extend({
  accountId: z.string().trim().min(2).max(64),
});

export const demoActionInput = z.enum(["session", "simulate-payment", "reset"]);

/**
 * What a demo press does to an open payment (PRD FR-22). `next` is the happy path one step at a
 * time; the rest are the outcomes worth showing a judge that are not on it. The words live here
 * rather than in `lib/server/demo.ts` so the browser bundle can offer exactly the same choices.
 */
export const demoOutcomeInput = z.enum([
  "next",
  "paid",
  "underpaid",
  "refunded",
  "failed",
  "expired",
]);

export const demoSimulateInput = z.object({
  publicId: z.string().trim().min(1).max(64),
  outcome: demoOutcomeInput.default("next"),
});

/** Receipt links are `{attemptId}?token=…`; the token is the only authorisation there is. */
export const receiptQueryInput = z.object({
  token: z.string().min(16).max(128),
});

/**
 * Which signature `GET /api/auth/challenge` is minting a nonce for (S7.12, #109). Only these two
 * fixed intents exist, so the endpoint can never be asked to hand back arbitrary text to sign — it
 * returns a nonce and, for a session, its own fixed dialog wording.
 */
export const challengeIntentInput = z.enum(["session", "payout"]);

export const challengeQueryInput = z.object({
  intent: challengeIntentInput,
});

/** `GET /api/invoices?status=paid&limit=10`. */
export const invoiceListQueryInput = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceInput>;
export type PayoutInput = z.infer<typeof payoutInput>;
export type SignedMessage = z.infer<typeof signedMessage>;
export type PayQuoteInput = z.infer<typeof payQuoteInput>;
export type SubmitTxInput = z.infer<typeof submitTxInput>;
export type SignInInput = z.infer<typeof signInInput>;
export type DemoAction = z.infer<typeof demoActionInput>;
export type DemoOutcome = z.infer<typeof demoOutcomeInput>;
export type DemoSimulateInput = z.infer<typeof demoSimulateInput>;
export type ReceiptQueryInput = z.infer<typeof receiptQueryInput>;
export type InvoiceListQueryInput = z.infer<typeof invoiceListQueryInput>;
export type ChallengeIntent = z.infer<typeof challengeIntentInput>;
