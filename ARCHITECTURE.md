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
| NEAR | **wallet selector v10** for sign-in (`@near-wallet-selector/{core,react-hook,modal-ui,my-near-wallet,hot-wallet}@10.1.4` — S0.14, see §11); NEP-413 verification; RPC views (`storage_balance_of`); one app-funded account to pay USDC storage for payout accounts |
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
| `GET /api/payout` | session | Current payout destination (what the settings page shows before it asks for a signature) |
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

Conventions every route follows:
- **Handlers stay thin.** `zod-validate → call `lib/server` → respond`. Status codes, error codes and
  what a client may see live in `lib/server/http.ts` and `lib/server/views.ts`, not in `route.ts`.
- **One signature message.** A payout change signs `Settle payout change to <address> on <chain>`
  (`lib/core/payout-message.ts`), built by the settings page and re-derived by `PUT /api/payout`.
  Quoting both values is what stops one signature from authorising a different address.
- **A bad id is absent, not invalid.** `:id` and `:attemptId` are checked as uuids before the read
  (`lib/core/ids.ts`); a malformed id, someone else's invoice and a non-existent one all answer the
  same 404 with the same text. Postgres errors on a non-uuid, and an error would leave as a 500.
- **Rate limits reply with `Retry-After`.** Quotes and status polls each have their own bucket keyed
  by `publicId` + client IP.

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

**Transport (S2.1).** Requests go out through our own `fetch` wrapper (`lib/oneclick/client.ts`) with zod schemas at the boundary, not through the SDK's generated service classes: those drive axios with no injection point, so tests could not run offline (AGENTS.md §8), and they hand back unvalidated JSON (§6). The SDK is still the source of the API types (`z.nativeEnum` over its enums, so a parsed value is assignable without a cast) and of `quoteHash()` / `verifyQuoteSignature()`, which are the parts only the vendor can define. Paths, query keys and bodies were copied from SDK 0.1.26.

**Amount minimums (S2.2).** There is no published minimums table: 1Click rejects at quote time with HTTP 400 and `try at least <baseUnits>`, which `parseTooLowMinimum()` lifts out of the message onto `OneClickError.minimumBaseUnits`, so the UI can offer the smallest valid amount instead of a guess.

**What happens to the difference (read from SDK 0.1.26's own docs, 2026-11-05).** For `EXACT_OUTPUT`: a deposit above `amountIn` is refunded to `refundTo` after the swap; a deposit below `minAmountIn` is refunded by the deadline. `feeUsd` is derived as `amountInUsd − amountOutUsd` and stays display-only (§6).

### 3.3 Status mapping

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

The seven-value enum is no longer a guess: `SDK_ONECLICK_STATUSES` (read out of the installed SDK, itself generated from the live OpenAPI schema) is asserted equal to `ONECLICK_STATUSES` by a test in `lib/oneclick/status.test.ts`, and all seven are exercised from `__fixtures__/statuses.json`. A status string outside the union is rejected as `malformed_response`, never mapped. `/v0/history` omits `KNOWN_DEPOSIT_TX`, so polling `/v0/status` stays the only reliable read.

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
On setting a USDC-on-NEAR payout: RPC `storage_balance_of(account)` on the USDC contract; if missing, the app's `STORAGE_PAYER` account calls `storage_deposit(account)`.

**S0.9 answered from the docs (2026-11-05, still unconfirmed by the vendor):** there is no evidence that 1Click registers NEAR recipients — and its low-level `ft_withdraw` intent documents the opposite hazard: a withdrawal to an account with no storage balance is *not* refunded. So app-paid registration stays in scope (S-B1), and `lib/near/storage.ts` reads the contract's own `storage_balance_bounds.min` plus the account's balance instead of assuming a constant; an account that does not exist yet counts as unregistered, because a payout address is valid before it is funded. `checkStorageRequirement` is read-only — the transaction that spends payer funds is **S2.10**, which needs the funded `STORAGE_PAYER` (S0.10), the NEAR signing dependency (S0.14) and an explicit human "yes" (AGENTS.md §7).

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
| Invoice enumeration | Unguessable `public_id`; minimal public data; a malformed id answers as an unknown one |
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
ONECLICK_MANAGER_PUBLIC_KEY=   # only to override the manager key (test fixture / rotation)
```
`NEAR_RPC_URL` is optional: without it the NEAR reads answer `not_configured` instead of guessing a
node. `ONECLICK_MANAGER_PUBLIC_KEY` is what lets the route tests verify a quote signed by the fixture
key; unset, the SDK's built-in production manager key is used.

---

## 9. Testing
- Unit: money/rounding, status mapping (every value), monotonic transitions, overpaid/paid-after-cancel logic, address validators, quote verification (valid + tampered fixtures), NEP-413 verify.
- Integration, still offline: every 1Click read and write runs against recorded fixtures in `lib/oneclick/__fixtures__/` through the same `fetch` the live client uses. `quote-real.json`, `quote-dry.json`, `statuses.json` and `tokens.json` are shaped from SDK 0.1.26 and re-signed in-test by a throwaway ed25519 key (`__fixtures__/signing.ts`), which gives both halves S2.4 asks for: a signature the vendor's own `verifyQuoteSignature()` accepts, and one that stops verifying when a signed field is edited. They are **not** live recordings — that needs the partner JWT (S0.8).
- DB: `lib/db/queries/*` is tested against a real Postgres — PGlite in memory (`memory://`) with the real migration applied per test file. No mocks, no hosted database.
- API: happy path + validation + auth per route, tested at the route. `lib/server/__fixtures__/routes.ts`
  installs a PGlite database, a scripted 1Click `fetch` (including tampered quotes and injected 5xx), a fake
  NEAR RPC read and a frozen clock, then the test calls the exported `GET`/`POST` of the real `route.ts` — so
  the handler, `lib/server`, the queries and the vendor's signature verifier all run together. Nothing of ours
  is mocked.
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
| S-B1 | Payout to a NEAR account not registered on USDC → delivery fails/refunds | Storage check + app-paid registration (3.5; read-only in S2.8, the spend is S2.10) 🔍 docs say nothing registers recipients — unconfirmed by the vendor |
| S-B2 | Typo in payout address → permanent loss | Validation, typed twice, chain named, change log |
| S-B3 | Exchange withdrawal fee → `INCOMPLETE_DEPOSIT` | Warning before sending; clear underpaid screen; top-up if 1Click allows 🔍 |
| S-B4 | Client switches token, pays both | One active attempt; warning about live old address; `overpaid` |
| S-B5 | AI screener can't run it | `pnpm demo` with zero secrets and PGlite |
| S-B6 | BTC-origin payments miss the deadline | Deadline per origin chain from 1Click time estimate 🔍 |
| S-B7 | 1Click down / no route | Clear message, retry later, never fake a status |

### Edge cases
Payment after cancel · overpayment: the excess above `amountIn` is refunded to `refundTo` after the swap (§3.2), so `overpaid` needs no manual step · client already holds the payout asset on the payout chain (same-asset quote may not exist 🔍 → show direct-transfer instructions) · refund address on a memo chain · per-line rounding · payout changed while a quote is live (snapshot) · region not served by 1Click (show error) · invoice total below 1Click minimum (answered: a 400 carrying `try at least N`, surfaced as `minimumBaseUnits` — the minimum-invoice decision #64 is still open).

### Overengineering avoided
No contract in MVP · no custody · no relayer (receiving needs no gas) · single app, no monorepo · no queue, two simple loops · no reconcile job.

### Answered: wallet sign-in packages and NEP-413 (S0.14, 2026-11-05)
Read off the installed packages (`@near-wallet-selector/*@10.1.4`, `near-api-js@7.4.0`) plus NEP-413,
and confirmed in code by `lib/near/nep413.test.ts`, which compares our serialiser with the library's
`serializeNep413` byte for byte and checks a signature from each against the other's verifier.

- **Sign-message support exists**: `wallet.signMessage({message, recipient, nonce: Buffer, callbackUrl?, state?})`
  → `{accountId, publicKey: "ed25519:…", signature: <base64>, state?}`. Implemented by MyNearWallet,
  HOT, Meteor, Ledger, WalletConnect, Nightly and Intear. **`ethereum-wallets` (MetaMask) throws** for it,
  so MetaMask is not a sign-in option for Settle.
- **The digest is not `"near:" + JSON`.** NEP-413 Borsh-serialises `{tag u32 = 2**31+413, message,
  nonce[u8;32], recipient, callbackUrl?}`, and the wallet signs `sha256` of those bytes — so the JSON shape
  `verifyNep413` was built on cannot come from a wallet-selector wallet. `lib/near/nep413.ts` now verifies
  both shapes and nothing else does: `verifyNep413SignedMessage` for the standard one (which is what real
  sign-in posts), `verifyNep413` for the JSON/RAAT convention our own signed fixtures produce.
  Nothing sends the standard shape yet, because the client that would is Phase 4.
- **A caller passes only the fields the signature covers.** `accountId` and the wallet's echoed `state` are
  not in the payload, so a handler strips them before verifying — otherwise an unsigned field could sit
  next to a signed one and read like part of the claim.
- **`signIn({messagePayload})` is gone in v10**; the signing call above is the only way to prove account control.
- **Deviation, deliberate:** NEP-413's reference check (`verifyFullKeyBelongsToUser`) insists the signing key
  is `FullAccess`. Settle checks the stronger thing instead — that the key is in the account's own access-key
  list (`getAccessKeys`, S2.6) — and does not require FullAccess, because owning a key that *could* sign a
  message is the authorisation fact; whether the key is full-access only says what else it could do.
- **Excluded deps:** `@near-wallet-selector/near-api-js` and `…/metamask` no longer exist in v10 (its
  migration note says to remove `near-api-js`), and `near-api-js@7` dropped `keyStores` while its
  `engines` ask for node ≥ 22.22.2 against our ≥ 20. We keep our own RPC client (`lib/near/rpc.ts`) and
  the noble/bs58 primitives, so the wallet packages stay browser-side only.
- 🔍 still unverified: one real end-to-end login against a live wallet (the byte layout is the library's,
  the *dialog* — what a wallet shows the human — is not testable offline).

