ALTER TABLE "payment_attempts" ADD COLUMN "deposited_amount" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refunded_amount" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refund_reason" text;