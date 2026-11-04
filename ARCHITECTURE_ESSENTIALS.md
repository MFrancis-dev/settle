# ARCHITECTURE ESSENTIALS — Settle (track 08)

> Quick reference for coding agents. Full: `ARCHITECTURE.md`. Product: `PRD.md`. Layout: `project_structure.md`. Work left: `ROADMAP.md`.
> **Every contribution updates `ROADMAP.md`.** If code disagrees with a rule here, stop and ask.

## One line
Client pays an invoice in any token on any chain → 1Click delivers the **exact** USD amount **directly** to the freelancer's payout destination. Settle never holds funds. Track `realworld`.

## Independence (hackathon Q-015)
Separate repo from **Stack** (track 01). Never import Stack code; README names Stack.

## ✅ Decided
- No smart contract in MVP (receipt registry = stretch)
- No custody, no relayer
- Single Next.js app + `worker/` script (no monorepo)
- PGlite for local/demo, Postgres when `DATABASE_URL` is set
- **SD-4** Payout assets: USDC on NEAR (default), Base, Arbitrum, Solana, Ethereum; USDT on Ethereum, Solana (ids: ARCHITECTURE §3.2)
- **SD-5** Name: Settle

## 🔍 Verify before coding against
1. Does 1Click storage-register NEAR recipients on USDC?
2. `/v0/status` enum; top-up after `INCOMPLETE_DEPOSIT`; overpayment; deposits after deadline
3. Same-asset quotes (client already holds the payout asset)
4. Minimum amounts · wallet selector package

## Stack
Next.js 15 + TS strict · Tailwind + shadcn/ui · TanStack Query · zod · Drizzle (PGlite/Postgres) · 1Click SDK ≥ 0.1.24 · wallet selector (NEP-413 sign-in) · vitest + Playwright · pnpm

## 1Click rules
- `EXACT_OUTPUT` · destination = payout asset · recipient = payout address · refundTo = client address · deadline per origin chain
- `verifyQuoteSignature()` before showing `depositAddress`
- Asset ids + decimals from `/v0/tokens` (cached), never hardcoded
- No quote on page load; "Get payment address" button only; rate limited
- One active real attempt per invoice
- After tx hash: `/v0/deposit/submit`; poll `/v0/status`

## Status mapping
| 1Click | Attempt | Invoice |
|---|---|---|
| PENDING_DEPOSIT | awaiting_deposit | open |
| KNOWN_DEPOSIT_TX | payment_detected | payment_detected |
| PROCESSING | processing | processing |
| SUCCESS | success | paid / overpaid / paid_after_cancel |
| INCOMPLETE_DEPOSIT | underpaid | underpaid |
| REFUNDED | refunded | open |
| FAILED | failed | open + alert |
| deadline, no deposit | expired | open |
Transitions are monotonic per attempt.

## Payout destination rules
- Default USDC on NEAR to the signed-in account; storage-registered by the app if needed
- Change = fresh NEP-413 signature + typed twice + chain named + change log
- Each attempt stores the destination snapshot it used

## Data model (amounts numeric(78,0) base units)
`users` · `payout_destinations` (history) · `invoices` + `invoice_items` · `payment_attempts` (deposit_address uniq, payout_destination_id, quote_raw, signature, status, receipt_token)

## Worker
`pollPayments` 5 s · `expireQuotes` 60 s

## Demo & dry-run
`pnpm demo` = zero secrets, PGlite, seeded invoices in every status, simulate payment. Dry-run = real `dry: true` quotes. Demo never moves funds.

## Never
Hold user funds · show unconfirmed statuses · use an unverified quote · put client data on-chain · commit secrets · send funds, deploy, post, push or submit without the human's explicit OK · finish a contribution without updating `ROADMAP.md`

## Env
`ONECLICK_BASE_URL ONECLICK_JWT NEAR_RPC_URL USDC_CONTRACT_ID STORAGE_PAYER_ACCOUNT_ID STORAGE_PAYER_PRIVATE_KEY DATABASE_URL SESSION_SECRET PUBLIC_APP_URL`
