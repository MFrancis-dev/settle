# ARCHITECTURE — Settle (track 08)

> Companion to `PRD.md`. Short version: `ARCHITECTURE_ESSENTIALS.md`. File layout: `project_structure.md`. Remaining work: `ROADMAP.md`.
> Items marked **[verify]** must be confirmed against current docs before coding against them.
> Every contribution updates `ROADMAP.md`.

---

## 1. Overview

```
 Client (any chain)                 Settle (one Next.js app + worker script)
 ──────────────────                 ─────────────────────────────────────────
 opens /pay/{id} ─────────────────► Pay page ──► Quote service ──► 1Click API
 sends tokens to depositAddress ─┐            ◄── verified quote ◄──  /v0/quote
                                 │  Worker ──► /v0/status (poll)      /v0/tokens
                                 │     └──► DB (PGlite local / Postgres hosted)
                                 ▼
                       NEAR Intents (solvers)
                                 │  delivers exact invoice amount
                                 ▼
            Freelancer's payout destination (USDC on NEAR by default,
            or a stablecoin on another chain at an address they own)
```

**Money never touches Settle.** The quote's `recipient` is the freelancer's own address; refunds go to the client's own address. Settle only stores invoices, quotes and statuses.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| App | **Next.js 15** (App Router) + **TypeScript** (strict), Tailwind CSS, shadcn/ui, TanStack Query |
| Validation | `zod` at every boundary (bodies, env, 1Click responses) |
| 1Click | `@defuse-protocol/one-click-sdk-typescript` ≥ 0.1.24 (`verifyQuoteSignature`) |
| NEAR | wallet selector for sign-in **[verify package]**; NEP-413 verification; RPC views (`storage_balance_of`); one app-funded account to pay USDC storage for payout accounts |
| DB | **Drizzle ORM**: **PGlite** for local + demo (zero config), **Postgres** when `DATABASE_URL` is set (hosted) |
| Worker | `worker/index.ts` run with `tsx`; interval loops; long-running host (not serverless) |
| Address validation | per-chain validators (EVM checksum, NEAR account rules, others via a small, listed library) |
| Tests | `vitest`, Playwright (demo journey) |
| Package manager | `pnpm` (single app, no workspaces) |

No smart contract in the MVP (stretch: receipt registry, §10).

---

## 3. Components

### 3.1 API routes (`app/api`)

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/session` | NEP-413 message | Sign in; HTTP-only cookie |
| `GET /api/me` | session | Profile + payout destination |
| `PUT /api/payout` | session + **fresh** NEP-413 | Set/change payout destination; logs change |
| `POST /api/invoices` · `GET /api/invoices` | session | Create / list |
| `GET /api/invoices/:id` · `POST /api/invoices/:id/cancel` | session | Detail / cancel |
| `GET /api/pay/:publicId` | public | Public invoice view |
| `GET /api/tokens` | public | Cached 1Click token list |
| `POST /api/pay/:publicId/quote` | public, rate-limited | `{originAsset, refundTo, dry}` → preview or PaymentAttempt |
| `POST /api/pay/:publicId/submit-tx` | public | Forward tx hash to `/v0/deposit/submit` |
| `GET /api/pay/:publicId/status` | public | Current attempt status |
| `GET /api/receipts/:attemptId` | public link w/ token | Receipt |
| `GET /api/export.csv` | session | Ledger CSV |
| `POST /api/demo/:action` | demo session | `simulate-payment`, `reset` |

### 3.2 1Click integration (`lib/oneclick`)

Base `https://1click.chaindefuser.com`; `ONECLICK_JWT` avoids the extra unauthenticated fee.

Invoice quote:
```json
{
  "dry": false,
  "swapType": "EXACT_OUTPUT",
  "slippageTolerance": 100,
  "originAsset": "<client-chosen assetId>",
  "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "<freelancer payout assetId>",
  "amount": "<invoice total in payout-asset base units>",
  "recipient": "<freelancer payout address>",
  "recipientType": "DESTINATION_CHAIN",
  "refundTo": "<client refund address>",
  "refundType": "ORIGIN_CHAIN",
  "deadline": "<now + per-origin-chain window>"
}
```

**MVP payout assets (SD-4, ids from live `/v0/tokens` on 2026-11-04 — still resolve at runtime and match on assetId):**

| Payout | assetId | Decimals |
|---|---|---|
| USDC on NEAR (default) | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | 6 |
| USDC on Base | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | 6 |
| USDC on Arbitrum | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near` | 6 |
| USDC on Solana | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | 6 |
| USDC on Ethereum | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` | 6 |
| USDT on Ethereum | `nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near` | 6 |
| USDT on Solana | `nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near` | 6 |

Rules: `verifyQuoteSignature()` before showing `depositAddress`; asset ids + decimals from `/v0/tokens` (in-memory cache, 10 min); store the raw quote + signature; after a deposit tx hash is known, `/v0/deposit/submit`.

### 3.3 Status mapping **[verify enum]**

| 1Click | PaymentAttempt | Invoice |
|---|---|---|
| `PENDING_DEPOSIT` | `awaiting_deposit` | `open` |
| `KNOWN_DEPOSIT_TX` | `payment_detected` | `payment_detected` |
| `PROCESSING` | `processing` | `processing` |
| `SUCCESS` | `success` | `paid` (or `overpaid` / `paid_after_cancel`) |
| `INCOMPLETE_DEPOSIT` | `underpaid` | `underpaid` |
| `REFUNDED` | `refunded` | back to `open` (client can retry) |
| `FAILED` | `failed` | `open` + alert |
| deadline passed, no deposit | `expired` | `open` |

A second `success` on an already-paid invoice → `overpaid` with both attempts listed.

`deriveInvoiceStatus(current, cancelled, attempts)` in `lib/core/status.ts` evaluates, in order:

1. 2+ `success` → `overpaid`; exactly 1 → `paid`, or `paid_after_cancel` when the invoice was cancelled first.
2. No `success` in this read and the invoice is already settled → keep the recorded status (an invoice never un-pays).
3. Otherwise the strongest live attempt: `underpaid` > `processing` > `payment_detected`; `refunded`/`failed`/`expired` add no signal.
4. `cancelled` → `cancelled`; a `draft` with no attempts stays `draft`; else `open`.

Callers pass **every** attempt for the invoice — a partial list derives a weaker status. `canTransition` is a forward-only table with `success`, `refunded`, `failed`, `expired` absorbing; `expired` is only reachable from `awaiting_deposit`, because its rule is "deadline passed and no deposit".

### 3.4 Worker (`worker/`)

| Loop | Every | Does |
|---|---|---|
| `pollPayments` | 5 s | Non-terminal attempts → `/v0/status` → update attempt + invoice |
| `expireQuotes` | 60 s | Past deadline, no deposit → `expired` |

Idempotency: unique `deposit_address`; status updates are monotonic (never move backwards).

### 3.5 Payout storage registration
On setting a USDC-on-NEAR payout: RPC `storage_balance_of(account)` on the USDC contract; if missing, the app's `STORAGE_PAYER` account calls `storage_deposit(account)` **[verify whether 1Click handles this; if so, drop it]**.

---

## 4. Data model

Amounts: `numeric(78,0)` base units (strings in TS, `bigint` in math).

```sql
users (
  id uuid pk, near_account_id text unique not null, display_name text not null,
  email text, is_demo boolean default false, created_at timestamptz default now()
)

payout_destinations (            -- history; latest active row is current
  id uuid pk, user_id uuid fk, asset_id text not null, chain text not null,
  address text not null, active boolean not null, created_at timestamptz default now()
)

invoices (
  id uuid pk, public_id text unique not null, user_id uuid fk, number text not null,
  client_name text not null, client_email text, memo text, total numeric(78,0) not null,
  due_date date, status text not null, paid_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz default now(), unique(user_id, number)
)

invoice_items (
  id uuid pk, invoice_id uuid fk on delete cascade, description text not null,
  quantity numeric(18,4) not null, unit_price numeric(78,0) not null,
  amount numeric(78,0) not null, position int not null
)

payment_attempts (
  id uuid pk, invoice_id uuid fk, payout_destination_id uuid fk,  -- snapshot used
  origin_asset text not null, refund_to text not null,
  deposit_address text unique not null, deposit_memo text,
  amount_in numeric(78,0) not null, amount_out numeric(78,0) not null,
  fee_usd numeric, quote_deadline timestamptz not null,
  quote_signature text not null, quote_raw jsonb not null,
  oneclick_status text, status text not null, deposit_tx_hash text,
  delivery_tx_hash text, status_raw jsonb, receipt_token text unique,
  created_at timestamptz default now(), updated_at timestamptz default now()
)
```
Dry-run previews are not stored.

---

## 5. Flows

**Onboarding:** wallet sign-in → `POST /api/session` (NEP-413) → default payout = USDC on NEAR to the account → storage check (3.5).

**Payment:** freelancer creates invoice → client opens link → picks token + refund address → optional dry preview → "Get payment address" → real quote → verify → attempt stored → client sends → worker polls → `paid` → receipts.

**Payout change:** fresh NEP-413 signature → validate address twice → new `payout_destinations` row, old one inactive → only new quotes use it → banner on dashboard for 7 days.

---

## 6. Security

| Threat | Control |
|---|---|
| Hijacked session changes payout address | Fresh NEP-413 signature required; change log; snapshot per attempt; dashboard banner |
| Tampered 1Click response | `verifyQuoteSignature()` before display |
| Fake "paid" | Status only from 1Click, never from the client |
| Invoice enumeration | Unguessable `public_id`; minimal public data |
| Quote spam | No quote on page load; rate limit per IP + invoice |
| Secrets | `.env` only; `.env.example` names only |
| PII | Off-chain only |

---

## 7. Demo and dry-run
- `pnpm demo`: PGlite + seed (`is_demo` user, invoices in every status, payout destinations), demo session, banner.
- Adapters: `QuoteProvider`, `StatusProvider` interfaces in `lib/core/adapters.ts`; real (1Click) and demo implementations chosen by session type. Demo still fetches **real dry quotes** when the network is reachable, and falls back to recorded fixtures offline.

---

## 8. Configuration
```
ONECLICK_BASE_URL=https://1click.chaindefuser.com
ONECLICK_JWT=
NEAR_RPC_URL=
USDC_CONTRACT_ID=            # resolve from /v0/tokens; env only overrides
STORAGE_PAYER_ACCOUNT_ID=
STORAGE_PAYER_PRIVATE_KEY=
DATABASE_URL=                # empty → PGlite
SESSION_SECRET=
PUBLIC_APP_URL=
```

---

## 9. Testing
- Unit: money/rounding, status mapping (every value), monotonic transitions, overpaid/paid-after-cancel logic, address validators, quote verification (valid + tampered fixtures), NEP-413 verify.
- API: happy path + validation + auth per route.
- E2E: PRD §8 journey in demo mode.
- Manual: one small real payment, recorded for the video (human approval required).

---

## 10. Stretch: on-chain receipt registry
A tiny NEAR contract where the app records `{invoice_hash, attempt_id, amount, delivery_tx}` after `SUCCESS`, so a receipt can be checked on-chain. No funds involved. Only after MVP is demoable.

---

## 11. Design review: hard questions

### What would break?
| # | Break | Fix |
|---|---|---|
| S-B1 | Payout to a NEAR account not registered on USDC → delivery fails/refunds | Storage check + app-paid registration (3.5) 🔍 |
| S-B2 | Typo in payout address → permanent loss | Validation, typed twice, chain named, change log |
| S-B3 | Exchange withdrawal fee → `INCOMPLETE_DEPOSIT` | Warning before sending; clear underpaid screen; top-up if 1Click allows 🔍 |
| S-B4 | Client switches token, pays both | One active attempt; warning about live old address; `overpaid` |
| S-B5 | AI screener can't run it | `pnpm demo` with zero secrets and PGlite |
| S-B6 | BTC-origin payments miss the deadline | Deadline per origin chain from 1Click time estimate 🔍 |
| S-B7 | 1Click down / no route | Clear message, retry later, never fake a status |

### Edge cases
Payment after cancel · overpayment behaviour 🔍 · client already holds the payout asset on the payout chain (same-asset quote may not exist 🔍 → show direct-transfer instructions) · refund address on a memo chain · per-line rounding · payout changed while a quote is live (snapshot) · region not served by 1Click (show error) · invoice total below 1Click minimum 🔍.

### Overengineering avoided
No contract in MVP · no custody · no relayer (receiving needs no gas) · single app, no monorepo · no queue, two simple loops · no reconcile job.
