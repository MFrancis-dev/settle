/**
 * Database schema (Drizzle). Amounts are numeric(78,0) base units.
 * Roadmap: S2.7 · Spec: ARCHITECTURE.md §4
 * Status: scaffold — not implemented yet.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ATTEMPT_STATUSES, INVOICE_STATUSES } from "../core/status";

const baseUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  nearAccountId: text("near_account_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** History of payout destinations; exactly one active row per user. */
export const payoutDestinations = pgTable(
  "payout_destinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    assetId: text("asset_id").notNull(),
    chain: text("chain").notNull(),
    address: text("address").notNull(),
    active: boolean("active").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    deactivatedAt: ts("deactivated_at"),
  },
  (t) => [index("payout_destinations_user_idx").on(t.userId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: text("public_id").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    number: text("number").notNull(),
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email"),
    memo: text("memo"),
    total: baseUnits("total").notNull(),
    dueDate: date("due_date"),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
    paidAt: ts("paid_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("invoices_user_number_uq").on(t.userId, t.number)],
);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitPrice: baseUnits("unit_price").notNull(),
  amount: baseUnits("amount").notNull(),
  position: integer("position").notNull(),
});

/** One real (non-dry) 1Click quote for an invoice. Dry previews are not stored. */
export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    payoutDestinationId: uuid("payout_destination_id")
      .notNull()
      .references(() => payoutDestinations.id),
    originAsset: text("origin_asset").notNull(),
    refundTo: text("refund_to").notNull(),
    depositAddress: text("deposit_address").notNull().unique(),
    depositMemo: text("deposit_memo"),
    amountIn: baseUnits("amount_in").notNull(),
    amountOut: baseUnits("amount_out").notNull(),
    feeUsd: numeric("fee_usd"),
    quoteDeadline: ts("quote_deadline").notNull(),
    quoteSignature: text("quote_signature").notNull(),
    quoteRaw: jsonb("quote_raw").notNull(),
    oneclickStatus: text("oneclick_status"),
    status: text("status", { enum: ATTEMPT_STATUSES }).notNull().default("awaiting_deposit"),
    depositTxHash: text("deposit_tx_hash"),
    deliveryTxHash: text("delivery_tx_hash"),
    statusRaw: jsonb("status_raw"),
    receiptToken: text("receipt_token").unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("payment_attempts_invoice_idx").on(t.invoiceId)],
);

export type User = typeof users.$inferSelect;
export type PayoutDestinationRow = typeof payoutDestinations.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
