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
- **SD-6** Invoice numbering: `INV-0001`, sequential **per user** (`invoices_user_number_uq`), at least 4 digits, grows past 9999 without truncating
- **SD-7** Address checks use `@noble/hashes` (keccak256 → EIP-55) and `bs58` (Solana). A chain with no validator is **rejected**, never accepted unchecked

## 🔍 Verify before coding against
Answered from the docs while building Phase 2 (2026-11-05), still **unconfirmed by the vendor**:
1. **No evidence** 1Click storage-registers NEAR recipients — its `ft_withdraw` warns a withdrawal to an unregistered account is not refunded → the app keeps paying storage (S2.8 reads, S2.10 spends)
2. Status enum: exactly the seven values we map, pinned against the installed SDK by a test. Overpayment: the excess above `amountIn` refunds to `refundTo`. A deposit below `minAmountIn` refunds at the deadline. **Still open:** can a client top up after `INCOMPLETE_DEPOSIT`?
4. Minimums: no table — a 400 saying `try at least <baseUnits>`, surfaced as `OneClickError.minimumBaseUnits`

Still open: 3. same-asset quotes · the wallet selector package and the exact NEP-413 shape it signs (the published standard Borsh-serialises and prepends a 4-byte tag; Near Intents logins use the JSON-payload shape `lib/near/nep413.ts` verifies).

## Stack
Next.js 15 + TS strict · Tailwind + shadcn/ui · TanStack Query · zod · Drizzle (PGlite/Postgres) · 1Click SDK ≥ 0.1.24 · wallet selector (NEP-413 sign-in) · vitest + Playwright · pnpm

## 1Click rules
- `EXACT_OUTPUT` · destination = payout asset · recipient = payout address · refundTo = client address · deadline per origin chain
- `verifyQuoteSignature()` before showing `depositAddress` — a real quote's address is never returned or stored unverified
- Calls go through our own `fetch` + zod client (the SDK's services are axios with no injection point, so tests could not run offline); the SDK still supplies the types, `quoteHash()` and the verifier
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

Rules as implemented in `lib/core/status.ts`:
- An attempt moves forward only; `success`, `refunded`, `failed`, `expired` absorb. `expired` is reachable only from `awaiting_deposit` (the rule is "deadline passed **and no deposit**").
- Invoice: 2+ successes → `overpaid` · 1 success → `paid`, or `paid_after_cancel` if cancelled · else the strongest live attempt (`underpaid` > `processing` > `payment_detected`) · `refunded`/`failed`/`expired` → `open` · no attempts + `draft` stays `draft`.
- A read that shows no success never un-pays a settled invoice. Callers pass **every** attempt for the invoice.

## Payout destination rules
- Default USDC on NEAR to the signed-in account; storage-registered by the app if needed (cost read from `storage_balance_bounds`, never hardcoded; an account that does not exist yet counts as unregistered)
- Change = fresh NEP-413 signature + typed twice + chain named + change log
- Each attempt stores the destination snapshot it used
- Validators (`lib/core/address.ts`): NEAR account-id rules · EVM `0x`+40 hex with EIP-55 when mixed case (all-lower/all-upper pass unchecked) · Solana base58 decoding to exactly 32 bytes
- Origin-chain refunds (BTC, TON, …) have no validator yet → S1.7 / #100

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
