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

| Layer              | Choice                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App                | **Next.js 15** (App Router) + **TypeScript** (strict), Tailwind CSS v4, TanStack Query                                                                                                                                                                                                                                                                                                       |
| UI components      | hand-rolled in `components/ui/*` on Tailwind **role tokens** (`@theme` in `app/globals.css`: `--color-ink`, `--color-brand`, `--color-warn`, `--radius-card`, …). No component library: the parts that carry money are ~8 small files, and a library would have put its own words, rounding and focus styles between us and §6.                                                              |
| Validation         | `zod` at every boundary (bodies, env, 1Click responses)                                                                                                                                                                                                                                                                                                                                      |
| 1Click             | `@defuse-protocol/one-click-sdk-typescript` ≥ 0.1.24 (`verifyQuoteSignature`)                                                                                                                                                                                                                                                                                                                |
| NEAR               | **wallet selector v10** for sign-in (`@near-wallet-selector/{core,modal-ui,my-near-wallet,hot-wallet}@10.1.4` — S0.14, see §11); NEP-413 verification; RPC views (`storage_balance_of`); one app-funded account to pay USDC storage for payout accounts                                                                                                                                      |
| DB                 | **Drizzle ORM**: **PGlite** for local + demo (zero config), **Postgres** when `DATABASE_URL` is set (hosted). Both drivers are listed in `next.config.ts` → `serverExternalPackages`: bundled by webpack they hand Node a `URL` where `fs` wants a path, and every API route answers 500 `ERR_INVALID_ARG_TYPE` — a fault no unit test can see, because it only exists in the server bundle. |
| Worker             | `worker/index.ts` run with `tsx`; interval loops; long-running host (not serverless)                                                                                                                                                                                                                                                                                                         |
| Address validation | per-chain validators (EVM checksum, NEAR account rules, others via a small, listed library)                                                                                                                                                                                                                                                                                                  |
| Tests              | `vitest` (node by default; component tests opt into `jsdom` + `@testing-library/react` with a `@vitest-environment jsdom` docblock), Playwright (demo journey)                                                                                                                                                                                                                               |
| Package manager    | `pnpm` (single app, no workspaces)                                                                                                                                                                                                                                                                                                                                                           |

No smart contract in the MVP (stretch: receipt registry, §10).

---

## 3. Components

### 3.1 API routes (`app/api`)

| Route                                                     | Auth                        | Purpose                                                                                  |
| --------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/session`                                       | NEP-413 message             | Sign in; HTTP-only cookie                                                                |
| `GET /api/auth/challenge`                                 | none (nonce is not a cred)  | Mint the single-use nonce a sign-in or payout signature has to cover                     |
| `GET /api/me`                                             | session                     | Profile + payout destination                                                             |
| `GET /api/payout`                                         | session                     | Current payout destination (what the settings page shows before it asks for a signature) |
| `PUT /api/payout`                                         | session + **fresh** NEP-413 | Set/change payout destination; logs change                                               |
| `POST /api/invoices` · `GET /api/invoices`                | session                     | Create / list                                                                            |
| `GET /api/invoices/:id` · `POST /api/invoices/:id/cancel` | session                     | Detail / cancel                                                                          |
| `GET /api/pay/:publicId`                                  | public                      | Public invoice view                                                                      |
| `GET /api/tokens`                                         | public                      | Cached 1Click token list                                                                 |
| `POST /api/pay/:publicId/quote`                           | public, rate-limited        | `{originAsset, refundTo, dry}` → preview or PaymentAttempt                               |
| `POST /api/pay/:publicId/submit-tx`                       | public                      | Forward tx hash to `/v0/deposit/submit`                                                  |
| `GET /api/pay/:publicId/status`                           | public                      | Current attempt status                                                                   |
| `GET /api/receipts/:attemptId`                            | public link w/ token        | Receipt                                                                                  |
| `GET /api/export.csv`                                     | session                     | Ledger CSV                                                                               |
| `POST /api/demo/:action`                                  | demo session                | `simulate-payment`, `reset`                                                              |
| `GET /api/health`                                         | public, not rate-limited    | Liveness probe: 200 `ok` / 503 `degraded` when the database cannot be read               |

Conventions every route follows:

- **Handlers stay thin.** `zod-validate → call `lib/server` → respond`. Status codes, error codes and
  what a client may see live in `lib/server/http.ts` and `lib/server/views.ts`, not in `route.ts`.
- **One signature message.** A payout change signs `Settle payout change to <address> on <chain>`
  (`lib/core/payout-message.ts`), built by the settings page and re-derived by `PUT /api/payout`.
  Quoting both values is what stops one signature from authorising a different address.
- **A bad id is absent, not invalid.** `:id` and `:attemptId` are checked as uuids before the read
  (`lib/core/ids.ts`); a malformed id, someone else's invoice and a non-existent one all answer the
  same 404 with the same text. Postgres errors on a non-uuid, and an error would leave as a 500.
- **Rate limits reply with `Retry-After`.** Quotes (6/min) and status polls (60/min) each have their
  own bucket keyed by `publicId` + client IP; the signed-in writes (invoice create, cancel, payout
  change, sign-in, export) share a third bucket (`AUTH_LIMIT`, 10/min) keyed by action + IP + user id.
  `limitWrite()` is the first statement in those handlers, so a refused write does no signature or
  database work at all. All three are in-process token buckets (`lib/server/rateLimit.ts`); a second
  instance would each keep their own, which is stated rather than hidden.

### 3.2 1Click integration (`lib/oneclick`)

Base `https://1click.chaindefuser.com`; `ONECLICK_JWT` is the partner credential. Measured 2026-11-10 (S8.7): a **dry** quote answers 200 without a token, while a **non-dry** quote — the one that carries `depositAddress` — answers `400 Internal server error` without one and `401 Invalid token` with a bogus one; `GET /v0/tokens` answers 200 either way. The vendor's docs agree: unauthenticated quotes are allowed at +25 bps, but an address is issued only to a partner credential. So the JWT is required for a real quote, not for a preview (§8, S8.4/S8.7).

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

| Payout                 | assetId                                                                   | Decimals |
| ---------------------- | ------------------------------------------------------------------------- | -------- |
| USDC on NEAR (default) | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | 6        |
| USDC on Base           | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`        | 6        |
| USDC on Arbitrum       | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near`         | 6        |
| USDC on Solana         | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near`           | 6        |
| USDC on Ethereum       | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near`         | 6        |
| USDT on Ethereum       | `nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near`         | 6        |
| USDT on Solana         | `nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near`           | 6        |

Rules: `verifyQuoteSignature()` before showing `depositAddress`; asset ids + decimals from `/v0/tokens` (in-memory cache, 10 min); store the raw quote + signature; after a deposit tx hash is known, `/v0/deposit/submit`.

**Transport (S2.1).** Requests go out through our own `fetch` wrapper (`lib/oneclick/client.ts`) with zod schemas at the boundary, not through the SDK's generated service classes: those drive axios with no injection point, so tests could not run offline (AGENTS.md §8), and they hand back unvalidated JSON (§6). The SDK is still the source of the API types (`z.nativeEnum` over its enums, so a parsed value is assignable without a cast) and of `quoteHash()` / `verifyQuoteSignature()`, which are the parts only the vendor can define. Paths, query keys and bodies were copied from SDK 0.1.26.

**Amount minimums (S2.2, re-probed live 2026-11-09; #135 answered 2026-11-09).** There is no published minimums table — the answer arrives at quote time, and it arrives in two shapes. Both are classified `amount_too_low`, and `parseQuoteMinimum()` (`lib/oneclick/client.ts`) lifts whichever half the vendor actually stated onto `OneClickError.minimum`:

- `Amount is too low for bridge, try at least <baseUnits>` — HTTP 400, **in the payout asset's base units**, not the token being sent. Measured live on 2026-11-09: a BTC → USDC-on-Ethereum quote of 5 USDC refused with `try at least 6232326` and the next integer up was accepted, while that invoice cost 0.00008799 BTC to pay. A wNEAR payout (24 decimals) refused 1 wNEAR with `try at least 1248744537382978723404` — the same 24-decimal scale, which is what settles the question. Rendered **with the invoice's payout decimals** by `lib/ui/quote-failure.ts` (S7.6), because formatting it with the client's origin token would name an amount ~700× too large in an asset the client never receives.
- `Temporary swap limits: minimum swap amount is $100` — HTTP 400, seen live on a TRON origin, and **a USD figure with no base-unit number in it**. Converting $100 into an amount of the payout asset needs a price, and the only price source in this app is a quote from the exchange that just refused, so `describeQuoteFailure()` states the floor in dollars and says in the same sentence why it is not a token amount. A grouped figure (`$1,000`) deliberately does not parse: the guard makes the parser refuse rather than print $1.

Either way the client is told the invoice is below the route's floor and what to do about it; only the unit changes.

A route can also have **no** minimum at all: a USDC-on-NEAR → USDC-on-Ethereum dry quote for 1 base unit (0.000001 USDC) was accepted, quoted at 0.303095 in because `withdrawFee` alone is 300000 units. So "the vendor will reject a too-small invoice" is not a safety net Settle may rely on; the small-amount guard stays ours.

**What happens to the difference (S0.12 — docs and live dry quotes, re-read 2026-11-09).** The vendor's own words, from docs _Swap Types_: "Deposit below 0.99 NEAR → refunded after the deadline, **as long as the total received stays under `minAmountIn`**." The clause after "as long as" is the whole answer: a deposit is measured as a running total on one address, so

- **top-up after `INCOMPLETE_DEPOSIT` works** — a second deposit that brings the total to at least `minAmountIn` is swapped, and `underpaid` is a state the client can still fix. `lib/ui/status.ts` says exactly this, and `PayStatus.test.tsx` refuses a wording that drops it;
- **overpayment** — a deposit above `amountIn` is swapped and the excess is refunded to `refundTo` (the quote is a target, not a cap);
- **a deposit that arrives after the deadline**, or a total still under `minAmountIn` when the deadline passes, is **refunded whole** — not credited part-way, which is why the client-facing sentence promises "everything you sent comes back" rather than a shortfall coming back.

`feeUsd` is derived as `amountInUsd − amountOutUsd` and stays display-only (§6). None of this was observable from a dry quote alone; the lifecycle rules come from the docs and the deposit-address semantics from SDK 0.1.26.

**Origin chains served (live `/v0/tokens`, read 2026-11-09).** 216 assets across 39 blockchains, and that set includes `btc`, `ton` and `tron` — so `refundTo` can legitimately sit on a chain wider than the five payout chains SD-4 fixed, which is exactly the gap S1.7 [#100](https://github.com/MFrancis-dev/settle/issues/100) leaves open. What closes most of it is the vendor: 1Click validates `refundTo` itself. A malformed BTC string and the Solana system address were both refused with `refundTo is not valid` (HTTP 400), while a bech32 and a legacy BTC address passed the address check and were refused only on the amount. An unchecked origin address is therefore refused by 1Click rather than silently accepted — Settle's own validators would improve the message, not the safety. **Decided 2026-11-09 (S1.7, #100): validate BTC.** A Bitcoin refund address is now checked by Settle before the quote is sent — base58-check P2PKH/P2SH and segwit bech32/bech32m, mainnet only — so the client sees the problem in their own language, offline, instead of as the vendor's `refundTo is not valid`. BTC is a refund-only chain (`REFUND_ONLY_CHAINS`): the payout list SD-4 fixed is unchanged, and `refundChainFromCode` is a separate map from `chainFromCode` so no `btc` token can be offered as a payout asset. TON and Tron stay refused: a TON address would need its own user-friendly checksum implementation, and a memo chain cannot be refunded correctly without a memo field Settle does not have.

### 3.3 Status mapping

| 1Click                      | PaymentAttempt     | Invoice                                      |
| --------------------------- | ------------------ | -------------------------------------------- |
| `PENDING_DEPOSIT`           | `awaiting_deposit` | `open`                                       |
| `KNOWN_DEPOSIT_TX`          | `payment_detected` | `payment_detected`                           |
| `PROCESSING`                | `processing`       | `processing`                                 |
| `SUCCESS`                   | `success`          | `paid` (or `overpaid` / `paid_after_cancel`) |
| `INCOMPLETE_DEPOSIT`        | `underpaid`        | `underpaid`                                  |
| `REFUNDED`                  | `refunded`         | back to `open` (client can retry)            |
| `FAILED`                    | `failed`           | `open` + alert                               |
| deadline passed, no deposit | `expired`          | `open`                                       |

A second `success` on an already-paid invoice → `overpaid` with both attempts listed.

The seven-value enum is no longer a guess: `SDK_ONECLICK_STATUSES` (read out of the installed SDK, itself generated from the live OpenAPI schema) is asserted equal to `ONECLICK_STATUSES` by a test in `lib/oneclick/status.test.ts`, and all seven are exercised from `__fixtures__/statuses.json`. A status string outside the union is rejected as `malformed_response`, never mapped. `/v0/history` omits `KNOWN_DEPOSIT_TX`, so polling `/v0/status` stays the only reliable read.

`deriveInvoiceStatus(current, cancelled, attempts)` in `lib/core/status.ts` evaluates, in order:

1. 2+ `success` → `overpaid`; exactly 1 → `paid`, or `paid_after_cancel` when the invoice was cancelled first.
2. No `success` in this read and the invoice is already settled → keep the recorded status (an invoice never un-pays).
3. Otherwise the strongest live attempt: `underpaid` > `processing` > `payment_detected`; `refunded`/`failed`/`expired` add no signal.
4. `cancelled` → `cancelled`; a `draft` with no attempts stays `draft`; else `open`.

Callers pass **every** attempt for the invoice — a partial list derives a weaker status. `canTransition` is a forward-only table with `success`, `refunded`, `failed`, `expired` absorbing; `expired` is only reachable from `awaiting_deposit`, because its rule is "deadline passed and no deposit".

### 3.4 Worker (`worker/`)

| Loop           | Every | Does                                                            |
| -------------- | ----- | --------------------------------------------------------------- |
| `pollPayments` | 5 s   | Non-terminal attempts → `/v0/status` → update attempt + invoice |
| `expireQuotes` | 60 s  | Past deadline, no deposit → `expired`                           |

Idempotency: unique `deposit_address`; status updates are monotonic (never move backwards).

As implemented (S5.1–S5.3):

- **One write path.** `lib/server/sync.ts` (`syncAttempt`, `refreshInvoiceStatus`) is called by `pollPayments` _and_ by `GET /api/pay/:publicId/status` _and_ by `submit-tx`. The table above says the poll is the worker's write; sharing the module is what makes that true rather than aspirational. An invoice is always re-derived from **every** attempt it has, never from the one row that changed.
- **Bounded ticks.** `listLiveAttempts` / `listExpiredQuoteAttempts` cap a tick at 50 rows (`POLL_BATCH`, `EXPIRE_BATCH`), oldest first, so a backlog drains over several ticks instead of firing an unbounded burst at a partner service. Attempts are polled sequentially for the same reason.
- **A tick never throws.** 1Click being unreachable is `silent` (nothing is written, so "no signal yet" is never stored as "not paid"); an illegal transition is `failed`, logged with the attempt id and the error kind only — no address, no client name, no upstream body — and the rest of the tick still runs. One bad row must not freeze every other payment behind it.
- **Expiry is confirmed, not assumed.** `expired` is terminal and absorbs, so `expireQuotes` reads 1Click once more before writing: money that landed in the final seconds is recorded forward (`lateDeposit`), an unreachable service **defers** the decision to the next minute, and a 404 does expire — the service keeps no record of that deposit address, and leaving the row live would wedge the invoice under the one-live-attempt rule.
- **Graceful shutdown.** `stop()` sets a flag _and_ wakes the parked interval, then awaits the tick in flight. Killing a tick mid-write is how a payment ends up polled upstream and never recorded. A second signal exits immediately.
- **Nothing runs at import time.** `main()` is behind an entrypoint guard, so the Next.js app or a test can import this module without spawning a process; `sleep` is injected in tests, so scheduling is asserted without fake timers.

### 3.5 Payout storage registration

On setting a USDC-on-NEAR payout: RPC `storage_balance_of(account)` on the USDC contract; if missing, the app's `STORAGE_PAYER` account calls `storage_deposit(account)`.

**Quote-time guard (S7.15, 2026-11-11).** The check above runs when the payout is saved, which does not stop a client paying an invoice whose payout account is still unregistered. So `assertPayoutCanReceive()` (`lib/server/payout.ts`) runs again in the non-dry branch of `POST /api/pay/:publicId/quote`, outside demo mode, before 1Click is asked: not registered → `409 payout_not_ready`; registration unreadable → `503 upstream_unreachable`; no RPC configured, or a payout the check does not apply to → proceed. Neither refusal carries the seller's address, and the dry preview is untouched. Until S2.10 ships, this is what keeps an unregistered payout from being paid into.

**S0.9 answered from the docs (2026-11-05, still unconfirmed by the vendor):** there is no evidence that 1Click registers NEAR recipients — and its low-level `ft_withdraw` intent documents the opposite hazard: a withdrawal to an account with no storage balance is _not_ refunded. So app-paid registration stays in scope (S-B1), and `lib/near/storage.ts` reads the contract's own `storage_balance_bounds.min` plus the account's balance instead of assuming a constant; an account that does not exist yet counts as unregistered, because a payout address is valid before it is funded. `checkStorageRequirement` is read-only — the transaction that spends payer funds is **S2.10**, which needs the funded `STORAGE_PAYER` (S0.10), the NEAR signing dependency (S0.14) and an explicit human "yes" (AGENTS.md §7).

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

**Onboarding:** wallet sign-in → `GET /api/auth/challenge` (a nonce this process minted) → `POST /api/session` (NEP-413 signed over it) → default payout = USDC on NEAR to the account → storage check (3.5).

**Payment:** freelancer creates invoice → client opens link → picks token + refund address → optional dry preview → "Get payment address" → real quote → verify → attempt stored → client sends → worker polls → `paid` → receipts.

**Payout change:** `GET /api/auth/challenge` → fresh NEP-413 signature over it and over the new address → validate address twice → new `payout_destinations` row, old one inactive → only new quotes use it → banner on dashboard for 7 days.

---

## 6. Security

| Threat                                  | Control                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Hijacked session changes payout address | Fresh NEP-413 signature required; change log; snapshot per attempt; dashboard banner      |
| A captured signature replayed           | The nonce is minted by `GET /api/auth/challenge` and spent on first use, dead after 5 min |
| Tampered 1Click response                | `verifyQuoteSignature()` before display                                                   |
| Fake "paid"                             | Status only from 1Click, never from the client                                            |
| Invoice enumeration                     | Unguessable `public_id`; minimal public data; a malformed id answers as an unknown one    |
| Quote spam                              | No quote on page load; rate limit per IP + invoice                                        |
| Write spam / credential stuffing        | `AUTH_LIMIT` bucket on every signed-in route, consumed before any work                    |
| Payout address leaked through a refusal | The `same_asset` answer names the asset, never the destination address                    |
| Secrets                                 | `.env` only; `.env.example` names only                                                    |
| Upstream wording reaching the log       | `OneClickError.message` is log-safe; `.detail` is answered to the client and never logged |
| PII                                     | Off-chain only                                                                            |

---

## 7. Demo and dry-run

- `pnpm demo`: PGlite + seed (`demo-freelancer.near`, ten invoices — one per status the app can reach — and a payout-destination history), demo session, banner. `scripts/demo.ts` refuses to start if the environment would make "demo" a lie, seeds in a step that **closes** the connection first (PGlite hands its data directory to one process at a time), then spawns `next dev` with `DEMO_MODE=1`. `pnpm demo:seed --fresh` rewrites the story; without `--fresh` a story already in the database is left alone. `pnpm demo:prod` (`scripts/demo-prod.ts`) is its production sibling — same guards and same seed, but it runs `next build` first and serves with `next start`, so the e2e suite drives the artifact a host deploys; `pnpm demo` itself is unchanged and stays the command the README gives a judge.
- Adapters: `QuoteProvider`, `StatusProvider` interfaces in `lib/core/adapters.ts`; real (1Click) and demo implementations.
- **As implemented (S6.1–S6.6, 2026-11-06), the choice is process-wide, not per session.** `DEMO_MODE` is read once by `createPaymentAdapters` in `lib/server/adapters.ts`, so a single process is either demo or real and cannot be both. This is deliberately stronger than the "chosen by session type" sketch above: a per-session choice would let one process serve a demo session and a real one at the same time, which is the exact confusion `demoModeConflict` exists to prevent. `demoModeConflict` refuses `DEMO_MODE` next to a `DATABASE_URL` or an `https://` `PUBLIC_APP_URL`, and `assertDemoModeAllowed` re-checks on every `/api/demo/*` request (403 in real mode).
- The demo substitutes the **transport**, not the implementation: `lib/oneclick/demo.ts` is a `FetchLike` that answers `/v0/tokens` and `/v0/quote` from a recording, so every zod schema, every quote signature check and every status transition in `lib/server` runs unchanged. Dry quotes are forwarded and re-signed with the published demo ed25519 key, which `managerKeyFor(env)` pins as `DEMO_MANAGER_PUBLIC_KEY`, so the vendor's own verifier accepts them. A **non-dry** quote is never forwarded: a fake deposit address that looks real is the one thing a demo must not hand a client.
- `GET /v0/status` is answered from the **database**, not from a recording, because a recording cannot know what the demo just did. `simulatePayment` writes through `recordAttemptStatus` + `storeDerivedInvoiceStatus` — the same two functions the worker and the status poll use — and the transport mirrors the row back, so a simulated step and a real poll are one path. The route tests assert it (`polled: true`, same `invoiceStatus`); there is no second state machine.
- Demo sessions: `lib/server/session.ts` uses a fixed `DEMO_SESSION_SECRET` **only** in demo mode. `middleware.ts` runs on the Edge runtime and the route that issues the cookie runs on Node — two runtimes, two module instances — so a random per-process fallback was two different keys and every demo request 401'd. Publishing the key costs nothing because `demoModeConflict` forbids real data or a public origin next to it; real mode still requires `SESSION_SECRET` (`check-env`) and falls back to a random key, never to this one.
- Refusals that stay refusals in demo mode: `GET /api/export.csv` answers 403 for a demo account, because seeded rows must not leave the app looking like a real ledger.

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
DEMO_MODE=                     # 1 → this whole process is a demo (§7); `pnpm demo` sets it
```

`NEAR_RPC_URL` is optional: without it the NEAR reads answer `not_configured` instead of guessing a
node. `ONECLICK_MANAGER_PUBLIC_KEY` is what lets the route tests verify a quote signed by the fixture
key; unset, the SDK's built-in production manager key is used — except in demo mode, where
`managerKeyFor()` pins the published demo key from `lib/oneclick/demo.ts` so the recorded quotes
verify. `DEMO_MODE` is refused next to `DATABASE_URL` or an `https://` `PUBLIC_APP_URL`
(`demoModeConflict`), and it makes `SESSION_SECRET` optional (see §7).

---

## 9. Testing

- Unit: money/rounding, status mapping (every value), monotonic transitions, overpaid/paid-after-cancel logic, address validators, quote verification (valid + tampered fixtures), NEP-413 verify.
- Integration, still offline: every 1Click read and write runs against recorded fixtures in `lib/oneclick/__fixtures__/` through the same `fetch` the live client uses. `quote-real.json`, `quote-dry.json`, `statuses.json` and `tokens.json` are shaped from SDK 0.1.26 and re-signed in-test by a throwaway ed25519 key (`__fixtures__/signing.ts`), which gives both halves S2.4 asks for: a signature the vendor's own `verifyQuoteSignature()` accepts, and one that stops verifying when a signed field is edited. They are **not** live recordings — that needs the partner JWT (S0.8).
- DB: `lib/db/queries/*` is tested against a real Postgres — PGlite in memory (`memory://`) with the real migration applied per test file. No mocks, no hosted database.
- API: happy path + validation + auth per route, tested at the route. `lib/server/__fixtures__/routes.ts`
  installs a PGlite database, a scripted 1Click `fetch` (including tampered quotes and injected 5xx), a fake
  NEAR RPC read and a frozen clock, then the test calls the exported `GET`/`POST` of the real `route.ts` — so
  the handler, `lib/server`, the queries and the vendor's signature verifier all run together. Nothing of ours
  is mocked. The same harness has a `demo: true` mode: it builds deps exactly the way `pnpm demo` does
  (`DEMO_MODE` on, **no** injected transport, so `createPaymentAdapters` composes the demo one) and cuts the
  network instead of stubbing it — `globalThis.fetch` rejects. Nothing in the demo suite can pass by accident
  of a live upstream, and the demo transport is exercised as the deployment exercises it.
- UI: component tests in `jsdom` (`// @vitest-environment jsdom` docblock; the default environment stays `node` so the server suite never pays for a DOM). They cover the parts where a wrong word or a wrong number is a money bug: `Money`/`MoneyExact` (exact base units, and the label that says the token could not be resolved — never an invented decimal), `CopyButton` (it reports "Select it and press Ctrl+C" when the browser refused the clipboard, which is what a demo over plain http gets), `Countdown` (the expiry sentence, the screen-reader sentence, and `onExpire` firing once), `DepositPanel` (memo warning only when the network needs one) and `StatusBadge` (walks both status unions, so a new status cannot render as a blank pill). `lib/wallet/api-contract.test.ts` is the pair-test: the bodies a browser builds must survive `signInInput`/`payoutInput` **and** `verifyNep413SignedMessage`, because those two halves were once green separately and incompatible together.
- Worker: one tick per test, against the same harness — a real PGlite database, an attempt opened through the real quote route, a scripted 1Click and a frozen clock advanced past the quote's own deadline. `worker/index.test.ts` drives the loop runner with an injected `sleep`, so "did it poll again" and "did shutdown wait for the write" are assertions rather than timeouts. The process itself was also run: `pnpm worker` starts both loops and exits 0 on SIGTERM and SIGINT.
- E2E: PRD §8 journey in demo mode, in `e2e/demo-journey.spec.ts` and in CI (`e2e` job). Playwright starts `pnpm demo:prod` itself as its web server — a **production build** (`next build` then `next start` in demo mode, the two commands a host runs), not `next dev` — with no `.env` and a database that is never inherited from a previous run, and drives a real browser: the demo landing page, the demo cookie opening the dashboard **and** the CSV export refusing it, a full price → address → three-press payment ending on a receipt with its quote attestation, and a short payment plus a refund. The fifth test opens `/` — the landing page, which the journey otherwise never visits — and asserts both halves of server rendering: the HTML the server hands out offers wallet sign-in and does not deny it, and a real browser hydrates that HTML with **no `pageerror`** (S7.13, #140). Because routes are precompiled, there is no on-demand compile to warm and no inflated timeout. This is the only test that can see two of the three defects Phase 6 found (§7): the Edge/Node session-secret split, and receipt links that opened "No such receipt". It is also the only test that can see a **first-render divergence**: a component test runs in jsdom, where `window` exists on both renders, and `curl` runs no JavaScript at all, so a state seeded from `typeof window` looks correct to each of them and throws React #418 in the browser. It cannot be replaced by a unit test, because the live poll depends on `refetchInterval`, which React Query pauses in an unfocused tab — so a scripted browser that is not the foreground window never polls at all. Known gap: PRD §8 step 2 asks for "ETH on Arbitrum", which the recording does not contain, so the journey pays in wNEAR.
- Manual: one small real payment, recorded for the video (human approval required).

---

## 10. Stretch: on-chain receipt registry

A tiny NEAR contract where the app records `{invoice_hash, attempt_id, amount, delivery_tx}` after `SUCCESS`, so a receipt can be checked on-chain. No funds involved. Only after MVP is demoable.

---

## 11. Design review: hard questions

### What would break?

| #    | Break                                                                                                   | Fix                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-B1 | Payout to a NEAR account not registered on USDC → delivery fails/refunds                                | Storage check + app-paid registration (3.5; read-only in S2.8, the spend is S2.10) 🔍 docs say nothing registers recipients — unconfirmed by the vendor                                                                                                                             |
| S-B2 | Typo in payout address → permanent loss                                                                 | Validation, typed twice, chain named, change log                                                                                                                                                                                                                                    |
| S-B3 | Exchange withdrawal fee → `INCOMPLETE_DEPOSIT`                                                          | Warning before sending; clear underpaid screen; **top-up works** — deposits cumulate on one address (§3.2, answered 2026-11-09)                                                                                                                                                     |
| S-B4 | Client switches token, pays both                                                                        | One active attempt; warning about live old address; `overpaid`                                                                                                                                                                                                                      |
| S-B5 | AI screener can't run it                                                                                | `pnpm demo` with zero secrets and PGlite                                                                                                                                                                                                                                            |
| S-B6 | BTC-origin payments miss the deadline                                                                   | Deadline per origin chain from 1Click time estimate 🔍                                                                                                                                                                                                                              |
| S-B7 | 1Click down / no route                                                                                  | Clear message, retry later, never fake a status                                                                                                                                                                                                                                     |
| S-B8 | The HTML a screener reads denies a control that works, and React throws the server's markup away (#418) | No first render reads `window`: `WalletProvider` seeds `"loading"` on both runtimes and its effect resolves the real phase after mount. The e2e suite opens `/` and asserts the served HTML **and** a `pageerror`-free hydration (S7.13, #140 — found on the hosted URL, not by CI) |

### Edge cases

Payment after cancel (`paid_after_cancel`, `lib/core/status.ts` + route tests) · overpayment: the excess above `amountIn` is refunded to `refundTo` after the swap (§3.2), so `overpaid` needs no manual step, and **both** attempts are reported — the newest in full, the earlier one as `otherPayments` with status and refunded amount only, never an address or an id belonging to the other payer (S7.2) · short payment: the pay page renders `deposited` and `shortfall` as numbers, because "send the difference" is not actionable without the difference (S7.1) · client already holds the payout asset on the payout chain: refused with `same_asset` **before** a quote is asked for — and that refusal is Settle's choice, not a vendor limit, because a live dry quote for USDC-on-NEAR → USDC-on-NEAR is served (10.0 out for 10.105539 in, 2026-11-09). A same-asset client therefore _could_ pay, through Intents, for roughly a 1% fee. The reason we still refuse is that the alternative is telling them to transfer directly, and — deliberate deviation from the "show direct-transfer instructions" sketch — the answer names the asset and chain, not the seller's destination address, because a pay link is public and handing the destination to anyone holding one is the loss FR-6 exists to prevent (S7.4) · refund address on a memo chain: `unsupportedRefundReason()` says why a refund there is not recoverable, and the token picker lists every excluded network with its reason (S7.5, list is 🔍 ours — 1Click does not publish which origins carry a memo requirement) · per-line rounding (`lib/core/money.ts`) · payout changed while a quote is live: the snapshot holds, and `PUT /api/payout` now answers `openQuotes` — the count of live attempts still pointed at the address just replaced — so the settings page can say so (S7.8) · region not served by 1Click: the upstream refusal is passed through as `invalid_request` with its own wording rather than matched against guessed strings 🔍 (S7.9) · invoice total below 1Click minimum (answered: a 400 in **either of two shapes**, §3.2 — `try at least N` **in the payout asset's base units**, rendered by `describeQuoteFailure()` with the invoice's own payout decimals (not the token the client picked, which was the S0.13 finding that changed this code, S7.6), or `minimum swap amount is $100`, a dollar floor with no base units behind it, rendered as dollars together with the reason it cannot be a token amount (#135); both arrive as `amount_too_low`, so the advice is the same and only the unit changes; the refusal is reproducible live with an unauthenticated _dry_ quote; what still needs the partner JWT of S0.8/#11 is a non-dry one).

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
  both shapes: `verifyNep413SignedMessage` for the standard one, which is what `POST /api/session` and
  `PUT /api/payout` accept (the signed body is `{message, recipient, nonce, callbackUrl?, signature (base64),
publicKey}`), and `verifyNep413` for the JSON/RAAT convention that no wallet produces.
- **A caller passes only the fields the signature covers.** `accountId` and the wallet's echoed `state` are
  not in the payload, so a handler strips them before verifying — otherwise an unsigned field could sit
  next to a signed one and read like part of the claim.
- **`signIn({messagePayload})` is gone in v10**; the signing call above is the only way to prove account control.
- **Deviation, deliberate:** NEP-413's reference check (`verifyFullKeyBelongsToUser`) insists the signing key
  is `FullAccess`. Settle checks the stronger thing instead — that the key is in the account's own access-key
  list (`getAccessKeys`, S2.6) — and does not require FullAccess, because owning a key that _could_ sign a
  message is the authorisation fact; whether the key is full-access only says what else it could do.
- **Excluded deps:** `@near-wallet-selector/near-api-js` and `…/metamask` no longer exist in v10 (its
  migration note says to remove `near-api-js`), and `near-api-js@7` dropped `keyStores` while its
  `engines` ask for node ≥ 22.22.2 against our ≥ 20. We keep our own RPC client (`lib/near/rpc.ts`) and
  the noble/bs58 primitives, so the wallet packages stay browser-side only.
- 🔍 still unverified: one real end-to-end login against a live wallet (the byte layout is the library's,
  the _dialog_ — what a wallet shows the human — is not testable offline).

### Answered: does Settle need testnet for anything? (S7.14, 2026-11-10)

**No. No judged path can run on testnet, and one path would break silently if it did.**

Re-read live on 2026-11-10: https://nearhackathon.com/HACKATHON.md still answers Q-007 "Testnet for
Intents? None exists or is planned", and the vendor's own docs say the same in two places ("There is no
testnet deployment and no plans for one. We recommend testing on NEAR mainnet using separate dev/test
NEAR accounts"), so the answer is not a stale snapshot. Feature by feature:

- **1Click quotes, deposits and payouts** — mainnet only; the live `/v0/tokens` lists 216 assets whose
  `near` entries are all mainnet NEP-141 contracts (the one id containing "test" is a mainnet
  sub-account, `test-token.highdome3013.near`, not a test network). This is the integration the track
  judges, so Q-010 covers the entry: "Mainnet only where the integration is mainnet-only".
- **Wallet sign-in (NEP-413)** — the standard is network-agnostic, but the wallet's network and the
  server's `NEAR_RPC_URL` must agree. Mainnet wallet + testnet RPC fails the access-key read and refuses
  the login; testnet wallet + mainnet RPC is the dangerous mix, because the address validator accepts
  `alice.testnet`, 1Click would attempt a mainnet delivery to an account that does not exist there, and
  the freelancer would not be paid. `lib/ui/config.ts` therefore no longer reads a network variable:
  `NEAR_NETWORK` is the literal `"mainnet"`, and the only switch is demo vs real.
- **Storage check and the storage payer (S2.10)** — the check reads the real USDC contract's bounds and
  the real account's balance; on testnet it would read a test FT for an account that 1Click will never
  pay. Free testnet NEAR (Q-008) buys nothing here, because the spend path is blocked on a funded mainnet
  payer and an explicit human yes anyway.
- **Demo mode and dry-run quotes** — already the no-funds paths: `pnpm demo` touches no chain, and a
  `dry: true` quote is a real mainnet quote with no deposit address. Testnet is not a substitute for
  either, and the e2e suite runs entirely in demo mode.
- **Hosted deployment** — real mode against mainnet; production has no network variable set.
- **Prize payout account** — the submission form's only network requirement is a **mainnet** NEAR
  account. That is human-only and unchanged.

### Answered: can the web process and the worker share one PGlite directory? (Phase 8 prep, 2026-11-08)

**No, and the failure is silent.** Measured on `@electric-sql/pglite` 0.2.17 with two separate Node
processes opening the same data directory and each running 120 concurrent inserts:

- one process **died** with `ExitStatus { message: 'Program terminated with exit(1)' }` — the WASM
  Postgres aborts the process rather than throwing something a caller can catch;
- the other finished reporting **0 errors**, so its own log gives no sign anything went wrong;
- reopening the directory afterwards showed **only the survivor's 120 rows**. The dead process's
  writes were gone.

There is no cross-process lock. PGlite is an in-process database, which is exactly why it is the
right choice for local development, the test suite and `pnpm demo` — all single-process — and the
wrong choice for a deployment that runs `pnpm start` and `pnpm worker` side by side. **Any hosted
Settle must set `DATABASE_URL`.** Full deployment consequences, including the measured conflict
between demo mode and an `https://` `PUBLIC_APP_URL`, are in `DEPLOY.md`.

Migrations need no host-side step: `createDatabase()` applies every pending migration on open
(`lib/db/client.ts`) through `postgres` and `drizzle-orm`, both runtime dependencies, so
`drizzle-kit` is a development tool only.

**The contrast, measured the same day on PostgreSQL 16.15:** the identical two-process,
120-inserts-each race finished with **0 errors in both processes and all 240 rows persisted**, and
`pnpm start` plus `pnpm worker` booted together against one database with `/api/health` answering
`200 {"status":"ok","demo":false,"database":"ok"}` and every migration applied (five tables, 15
constraints, 12 indexes). Two processes migrating at once left `drizzle.__drizzle_migrations` with
2 rows and 2 distinct hashes for 2 files, so a host that starts both simultaneously is safe. That is
the topology **SD-8** buys: real mode, one Postgres, two long-lived processes (`DEPLOY.md` §3).
