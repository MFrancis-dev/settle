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
- **Mainnet only (S7.14)** NEAR Intents has no testnet and none is planned (vendor docs + hackathon Q-007, re-read 2026-11-10), so `NEAR_NETWORK` in `lib/ui/config.ts` is the literal `"mainnet"`; do not reintroduce a network switch. Demo mode and `dry: true` quotes are the no-funds paths; testnet is used for nothing. The submission's prize-payout account is the one mainnet account the human supplies
- **SD-7** Address checks use `@noble/hashes` (keccak256 → EIP-55, sha256 → base58-check) and `bs58` (Solana, Bitcoin). A chain with no validator is **rejected**, never accepted unchecked. **BTC is validated as a refund-only chain (2026-11-09, S1.7)**: bech32/bech32m and legacy mainnet addresses, never a payout chain

## 🔍 Verify before coding against

Answered from the docs while building Phase 2 (2026-11-05), still **unconfirmed by the vendor**:

1. **No evidence** 1Click storage-registers NEAR recipients — its `ft_withdraw` warns a withdrawal to an unregistered account is not refunded → the app keeps paying storage (S2.8 reads, S2.10 spends)
2. Status enum: exactly the seven values we map, pinned against the installed SDK by a test. Overpayment: the excess above `amountIn` refunds to `refundTo`. A deposit below `minAmountIn` refunds at the deadline. **Answered 2026-11-09:** a client can top up after `INCOMPLETE_DEPOSIT` — the vendor measures the running total on one address, so deposits add up until the deadline.
3. Minimums: no table — 1Click refuses at quote time in **two** shapes, `try at least <baseUnits>` (payout-asset units — that is what the number counts, measured live) and `minimum swap amount is $100` (dollars, no base units to convert). Both are `amount_too_low`, lifted onto `OneClickError.minimum` by `parseQuoteMinimum()`, and `lib/ui/quote-failure.ts` renders the first in **the invoice's payout asset** and the second as dollars, saying why a dollar floor is not a token amount (S7.6, S0.13, #135)

Still open: one live end-to-end wallet login (the shape below is the library's code, the wallet's own confirmation dialog is not testable offline).

**Answered 2026-11-06 (S7.4) — same-asset quotes:** refused, not attempted. `lib/server/pay.ts` compares `origin.assetId === destination.assetId` and answers `409 same_asset` naming the asset and chain — it does **not** publish the seller's destination address (PRD §11 sketched "direct-transfer instructions"; a pay link is public, so the address stays private and the client is told to ask).

**Answered 2026-11-05 (S0.14) — wallet sign-in:** `@near-wallet-selector/*@10.1.4`; `wallet.signMessage({message, recipient, nonce: Buffer, callbackUrl?, state?})` → `{accountId, publicKey, signature (base64), state?}`. The signed bytes are **Borsh** `{tag u32 = 2**31+413, message, nonce[u8;32], recipient, callbackUrl?}` and the digest is `sha256` of them — _not_ `"near:" + JSON`. Since 2026-11-06 the **request path verifies that shape only** (`verifyNep413SignedMessage`); `verifyNep413` (the JSON convention) stays exported and tested with no caller. MetaMask (`ethereum-wallets`) **throws** on sign-message → not a sign-in option. v10 removed `signIn({messagePayload})` and tells you to drop `near-api-js` (v7 dropped `keyStores`, wants node ≥ 22.22.2) → wallet packages stay client-side, our own RPC + noble/bs58 do the server work.

## Stack

Next.js 15 + TS strict · Tailwind v4 role tokens, hand-rolled `components/ui/*` (no component library) · TanStack Query · zod · Drizzle (PGlite/Postgres) · 1Click SDK ≥ 0.1.24 · wallet selector (NEP-413 sign-in) · vitest (+ jsdom/Testing Library for components) + Playwright · pnpm

## 1Click rules

- `EXACT_OUTPUT` · destination = payout asset · recipient = payout address · refundTo = client address · deadline per origin chain
- `verifyQuoteSignature()` before showing `depositAddress` — a real quote's address is never returned or stored unverified
- Calls go through our own `fetch` + zod client (the SDK's services are axios with no injection point, so tests could not run offline); the SDK still supplies the types, `quoteHash()` and the verifier
- Asset ids + decimals from `/v0/tokens` (cached), never hardcoded
- No quote on page load; "Get payment address" button only; rate limited (quotes 6/min, status 60/min, signed-in writes 10/min via `limitWrite()` — the first statement in the handler, so a refused write does no signature or DB work)
- One active real attempt per invoice
- After tx hash: `/v0/deposit/submit`; poll `/v0/status`

## Status mapping

| 1Click                                 | Attempt          | Invoice                             |
| -------------------------------------- | ---------------- | ----------------------------------- |
| PENDING_DEPOSIT                        | awaiting_deposit | open                                |
| KNOWN_DEPOSIT_TX                       | payment_detected | payment_detected                    |
| PROCESSING                             | processing       | processing                          |
| SUCCESS                                | success          | paid / overpaid / paid_after_cancel |
| INCOMPLETE_DEPOSIT                     | underpaid        | underpaid                           |
| REFUNDED                               | refunded         | open                                |
| FAILED                                 | failed           | open + alert                        |
| deadline, no deposit                   | expired          | open                                |
| Transitions are monotonic per attempt. |

Rules as implemented in `lib/core/status.ts`:

- An attempt moves forward only; `success`, `refunded`, `failed`, `expired` absorb. `expired` is reachable only from `awaiting_deposit` (the rule is "deadline passed **and no deposit**").
- Invoice: 2+ successes → `overpaid` · 1 success → `paid`, or `paid_after_cancel` if cancelled · else the strongest live attempt (`underpaid` > `processing` > `payment_detected`) · `refunded`/`failed`/`expired` → `open` · no attempts + `draft` stays `draft`.
- A read that shows no success never un-pays a settled invoice. Callers pass **every** attempt for the invoice.

## Payout destination rules

- Default USDC on NEAR to the signed-in account; storage-registered by the app if needed (cost read from `storage_balance_bounds`, never hardcoded; an account that does not exist yet counts as unregistered)
- **No address for a payout that cannot receive (S7.15):** a real quote re-reads the registration first — unregistered → `409 payout_not_ready`, unreadable → `503`, neither naming the seller's address. The app-paid registration is still S2.10
- Change = fresh NEP-413 signature + typed twice + chain named + change log
- Each attempt stores the destination snapshot it used
- Validators (`lib/core/address.ts`): NEAR account-id rules · EVM `0x`+40 hex with EIP-55 when mixed case (all-lower/all-upper pass unchecked) · Solana base58 decoding to exactly 32 bytes · **BTC refunds** (`validateBitcoinAddress`): base58-check P2PKH/P2SH with a double-SHA256 checksum, and segwit bech32/bech32m with the BIP-173/350 rules, mainnet only
- Origin-chain refunds: **BTC validated (S1.7)**; TON and Tron refuse with a reason. `validateRefundAddress` is the wider gate, `validateAddress` stays the payout gate

## Routes (built in Phase 3; `/api/health` added in Phase 8)

- `route.ts` stays thin: zod-validate → `lib/server/<area>.ts` → respond. Codes and payloads come from `lib/server/http.ts` + `views.ts`.
- Every handler is given `ServerDeps` (`lib/server/deps.ts`); tests install PGlite + a scripted 1Click `fetch` and call the same exports the app calls.
- A malformed uuid id answers the same 404 as an unknown or foreign one (`lib/core/ids.ts`) — never a 500.
- Payout changes sign `Settle payout change to <address> on <chain>` (`lib/core/payout-message.ts`); the settings page and `PUT /api/payout` must derive it identically.
- Quotes: 6/min per `publicId`+IP; status polls: 60/min. Rejection carries `Retry-After`.
- `POST /api/demo/:action` answers 403 unless the whole process is a demo (`assertDemoModeAllowed`).
- `GET /api/health` answers 200 `ok` / 503 `degraded` when the database cannot be read. Unauthenticated (a load balancer has no cookie), `no-store`, and the one route not rate limited: it calls no upstream and writes nothing, so throttling it would only make a host mark a healthy container down.
- **Two runtimes, one secret:** `middleware.ts` runs on Edge and route handlers on Node, so any per-process module state is _two_ values. `lib/server/session.ts` therefore takes the session secret from `sessionSecretFrom(env.SESSION_SECRET, isDemoMode(env))` — a fixed demo key in demo mode, a random fallback otherwise. Never add per-process randomness that a cookie has to survive across.

## UI (built in Phase 4)

- Client pages read `lib/api/types.ts`, a hand-written mirror of the server's views — a client component must never reach `lib/server` (it would pull the DB and the secrets into the bundle).
- Amounts: always the exact base-unit string. `amount`/`symbol`/`decimals` are the display half and are `null` when the token list could not be read → show base units **and say so**, never an estimated unit. Totals are summed per asset id, never across assets.
- The pay page creates nothing on load: first button is the free `dry: true` preview, the address comes from a second press, and one live attempt per invoice means a 409 with an `attemptId` re-reads the invoice instead of opening a second address.
- Every status the API can return has a sentence in `lib/ui/status.ts` (exhaustive `switch`); `role="alert"` is only on warn/danger so a poll never interrupts.
- `middleware.ts` puts the requested path in `?next=`; `lib/ui/return-path.ts` decides what may be pushed back (gated prefixes only — `//host` is an open redirect).
- `next.config.ts` → `serverExternalPackages: ["@electric-sql/pglite", "postgres"]`. Without it every API route 500s in the server bundle and the tests still pass.
- **No first render may read `window`.** `WalletProvider` seeds `"loading"` and its effect resolves the phase after mount; seeding from `WALLET_SUPPORTED` made the server HTML say "Wallet sign-in unavailable" while the browser offered sign-in, and React discarded the markup (#418, S7.13/#140). The e2e suite opens `/` and asserts the served HTML plus a `pageerror`-free hydration — jsdom and `curl` each see only one of the two renders.
- One identity, two grounds: app screens are the achromatic ledger on stone; the landing opens and closes on the **brand field** (green as a full hero, the receipt as the picture), with `invert`/`outline-invert` button variants and the `Mark`/`SignInButton` `onField` props carrying the chrome onto it (S4.12). Brand assets are generated, not hand-exported — `pnpm brand` rasterises the mark to `public/pfp.png` (1024², also the OG/Twitter image) and `app/icon.png` (256², favicon) (S4.13).

## Data model (amounts numeric(78,0) base units)

`users` · `payout_destinations` (history) · `invoices` + `invoice_items` · `payment_attempts` (deposit_address uniq, payout_destination_id, quote_raw, signature, status, receipt_token)

## Worker (built in Phase 5)

`pollPayments` 5 s · `expireQuotes` 60 s · both on the app's own `ServerDeps`, 50 rows max a tick, oldest first.

- The read-modify-write lives in **`lib/server/sync.ts`**, called by the worker _and_ by `GET /api/pay/:publicId/status` _and_ by `submit-tx` — one implementation, so the poll really is the worker's write. An invoice is always re-derived from **every** attempt it has.
- A tick never throws: 1Click down = `silent` (no write), illegal transition = `failed` (logged with the attempt id only — no address, no client, no upstream body), and the rest still run.
- Expiry is **confirmed**: `expired` is terminal, so `expireQuotes` reads 1Click once more — late money is recorded forward, an unreachable service defers a minute, a 404 expires (no record exists, and a live row would wedge the invoice).
- `stop()` wakes the parked interval and awaits the tick in flight; a second signal exits now. Nothing runs at import time (`main()` is entrypoint-guarded); `sleep` is injected in tests. Run for real: `pnpm worker` exits 0 on SIGTERM/SIGINT.

## Demo & dry-run (built in Phase 6)

- `pnpm demo` = zero secrets, no network, PGlite, ten seeded invoices (one per status the app can reach), simulate payment. Dry-run = real `dry: true` quotes. Demo never moves funds.
- `DEMO_MODE` is **process-wide**, read once by `createPaymentAdapters`: one process is either demo or real, never both. `demoModeConflict` refuses it next to a `DATABASE_URL` or an `https://` `PUBLIC_APP_URL`.
- The demo substitutes the **transport** (`FetchLike` in `lib/oneclick/demo.ts`), never the implementation — schemas, quote verification and status transitions all run unchanged. A **non-dry** quote is never forwarded (a fake address that looks real is the one thing a demo must not hand out); a dry quote is re-signed with the published demo key that `managerKeyFor()` pins.
- `GET /v0/status` is answered from the **database**. `simulatePayment` writes through `recordAttemptStatus` + `storeDerivedInvoiceStatus` — the worker's own path — so a simulated step and a real poll are one path, and there is no second state machine.
- `scripts/seed-demo.ts` closes the connection before `next dev` starts (PGlite gives its data directory to one process at a time) and reuses a story already there; `--fresh` rewrites it. `clearDemoData` is scoped to the demo account, so a real user's rows survive.
- Refusals that stay refusals: `/api/export.csv` is 403 for a demo account — seeded rows must not leave the app looking like a real ledger.

## Never

Hold user funds · show unconfirmed statuses · use an unverified quote · put client data on-chain · commit secrets · send funds, deploy, post, push or submit without the human's explicit OK · finish a contribution without updating `ROADMAP.md`

## Env

`ONECLICK_BASE_URL ONECLICK_JWT NEAR_RPC_URL USDC_CONTRACT_ID STORAGE_PAYER_ACCOUNT_ID STORAGE_PAYER_PRIVATE_KEY DATABASE_URL SESSION_SECRET PUBLIC_APP_URL DEMO_MODE`

`DATABASE_URL` is **mandatory for any hosted deployment**: PGlite is single-process, and a web process plus a worker sharing one data directory silently loses one process's writes (measured — `ARCHITECTURE.md` §11). `DEMO_MODE` must stay unset on a host, because demo mode refuses an `https://` `PUBLIC_APP_URL`. Both in `DEPLOY.md`. The hosted app therefore runs **real mode** (SD-8, decided 2026-11-08) — verified locally against PostgreSQL 16 with the web process and the worker running at the same time.
