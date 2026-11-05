# ROADMAP — Settle (track 08 · `realworld`)

> All remaining work to get this repo to **100% readiness** (submitted, public, demoable, judged-ready).
> **Every contribution updates this file in the same change** (AGENTS.md §0): task status, phase %, Readiness table, Blockers if any, and one Update-log line.
> **GitHub issues:** every task, open decision and stretch item has an issue on https://github.com/MFrancis-dev/settle/issues (linked next to its id). Hackathon rules checklist: [#1](https://github.com/MFrancis-dev/settle/issues/1). Keep issues and this file in sync (AGENTS.md §0.6).
> Deadline: **2026-11-14 23:59 UTC**. Target submission: **2026-11-13** (one day of buffer; sister project Stack submits on the 14th).

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done (add date) · `[!]` blocked (reason in Blockers) · `[-]` dropped (reason) · 👤 = human-only task · 🔍 = verify in docs · ⛔ = needs a human decision

---

## Readiness

| Phase | Target dates | Progress | Status |
|---|---|---|---|
| D. Design & docs | Nov 4 | 100% | ✅ done |
| 0. Setup & verification | Nov 4–5 | 63% | in progress (S0.9 answered from the docs; S0.8, S0.10, S0.12–S0.14 🔍/👤 and S0.16 remain) |
| 1. Core logic (`lib/core`) | Nov 5–6 | 86% | in progress (S1.1–S1.6 done, S1.7 blocked) |
| 2. Integrations (1Click, NEAR, DB) | Nov 5–7 | 90% | in progress (S2.1–S2.9 done; S2.10 spends payer funds, blocked) |
| 3. API routes | Nov 6–7 | 0% | not started |
| 4. UI | Nov 7–9 | 0% | not started |
| 5. Worker | Nov 8 | 0% | not started |
| 6. Demo mode & dry-run | Nov 9–10 | 0% | not started |
| 7. Hardening & edge cases | Nov 10–11 | 0% | not started |
| 8. Deploy & real run | Nov 11 | 0% | not started |
| 9. README & public repo | Nov 11–12 | 14% | in progress |
| 10. Launch: video, post, submission | Nov 12–13 | 0% | not started |
| 11. After submission | Nov 14–25 | 0% | not started |
| **Overall (MVP)** | | **~29%** | |

Phase % = done tasks ÷ non-dropped tasks in that phase. Overall = average of phases 0–10 weighted equally, with D counted.

## Definition of 100% readiness

- [ ] Every MVP task in phases 0–10 is `[x]` or `[-]` with a reason
- [ ] `pnpm demo` works on a fresh clone with no `.env`, no keys, no external DB
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` pass in CI
- [ ] Hosted demo URL is up and in the README
- [ ] One real end-to-end payment completed and linked in the README/video
- [ ] README: what, problem, how NEAR Intents is used, "do X → see Y", libraries, names **Stack**
- [ ] Repo public with MIT LICENSE
- [ ] Demo post live on X (@NEARProtocol, #NEARHackathon)
- [ ] Submission accepted (HTTP 201) with track `realworld`

## Blockers

- [S1.7] needs the live origin-chain list and #15's answer on overpayment/top-up before choosing per-chain validators or an accept-with-warning · the human's partner JWT (#11) unblocks the docs check · since 2026-11-04
- [S2.10] sending `storage_deposit` moves real funds from the app's payer account · blocked on S0.10 (👤 create + fund the payer), S0.14 (NEAR signing dep) and an explicit human "yes" (AGENTS.md §7) · since 2026-11-05

Format: `- [task id] what blocks it · who can unblock · since date`

## Decisions

| ID | Decision | Status |
|---|---|---|
| SD-1 | No contract in MVP; receipt registry = stretch | ✅ decided |
| SD-2 | No custody, no relayer | ✅ decided |
| SD-3 | Single Next.js app + worker; PGlite local/demo, Postgres hosted | ✅ decided |
| SD-4 [#2](https://github.com/MFrancis-dev/settle/issues/2) | Payout assets → **USDC on NEAR (default), Base, Arbitrum, Solana, Ethereum; USDT on Ethereum, Solana** (ids in ARCHITECTURE §3.2) | ✅ decided 2026-11-04 |
| SD-5 [#3](https://github.com/MFrancis-dev/settle/issues/3) | Working name → **"Settle" is final** | ✅ decided 2026-11-04 |
| SD-6 [#99](https://github.com/MFrancis-dev/settle/issues/99) | Invoice numbering → **`INV-0001`, sequential per user** (`invoices_user_number_uq`), ≥ 4 digits, grows without truncating | ✅ decided 2026-11-04 |
| SD-7 | Address validation → **`@noble/hashes` (keccak256, EIP-55) + `bs58` (Solana)**, both exact-pinned and listed in README (rule Q-005); chains without a validator are rejected rather than accepted unchecked | ✅ decided 2026-11-04 |

---

## Phase 0 — Setup & verification (Nov 4–5)

- [x] **S0.1** [#4](https://github.com/MFrancis-dev/settle/issues/4) 👤 Confirm product name (or pick a new one) · _done when_: name used in README/package.json · 2026-11-04: "Settle" confirmed (SD-5)
- [x] **S0.2** [#5](https://github.com/MFrancis-dev/settle/issues/5) `git init`, `.gitignore`, MIT `LICENSE`, README stub that names Stack · _done when_: first commit exists (👤 approves commit) · 2026-11-04: first commit approved and made; README links Stack; PR + issue templates added
- [x] **S0.3** [#6](https://github.com/MFrancis-dev/settle/issues/6) 👤 Create the GitHub repo and add the remote · 2026-11-04: created **public** at https://github.com/MFrancis-dev/settle on the human's instruction; `origin` set; `main` pushed
- [x] **S0.4** [#7](https://github.com/MFrancis-dev/settle/issues/7) (2026-11-04: installed with pnpm 11.17, exact versions pinned (Next 15.5.28, zod 3.25.76, Drizzle 0.36.4, PGlite 0.2.17, 1Click SDK 0.1.26); typecheck, lint, test (11 todo) and `next build` (15 pages, 14 API routes) all pass) Scaffold Next.js 15 + TS strict + Tailwind + shadcn/ui + ESLint/Prettier + vitest + Playwright; scripts named as in AGENTS.md §5 · _done when_: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck` run
- [x] **S0.5** [#8](https://github.com/MFrancis-dev/settle/issues/8) Drizzle with PGlite (no `DATABASE_URL`) / Postgres (with it) · _done when_: a test query runs on both · 2026-11-04: `lib/db/client.ts` opens + migrates the right engine; `lib/db/client.test.ts` inserts and reads a row on PGlite (always) and on Postgres (skipped unless `DATABASE_URL` is set). Both verified locally — Postgres against a throwaway instance on port 55432. CI exercises the PGlite half only.
- [x] **S0.6** [#9](https://github.com/MFrancis-dev/settle/issues/9) `lib/server/env.ts` (zod), `.env.example`, `scripts/check-env.ts` · 2026-11-04: empty `.env` values are treated as unset (demo mode parses clean); `check-env` lists missing names and exits 1 for real mode, never printing values. Split `env-schema.ts` out of `env.ts` because `server-only` throws under `tsx`, which would have broken `pnpm demo`'s seed script.
- [x] **S0.7** [#10](https://github.com/MFrancis-dev/settle/issues/10) CI: GitHub Actions running typecheck, lint, test; secret scanning (gitleaks) · 2026-11-04: `.github/workflows/ci.yml` — checks job (install, typecheck, lint, test, build) + gitleaks v8.30.1 over full history. Also fixed two broken repo commands: ESLint was linting the generated `next-env.d.ts`, and `pnpm format` errored on generated `drizzle/*.sql` (added `.prettierignore`).
- [ ] **S0.8** [#11](https://github.com/MFrancis-dev/settle/issues/11) 👤 Register a 1Click partner JWT (partners.near-intents.org) and put it in `.env`
- [x] **S0.9** [#12](https://github.com/MFrancis-dev/settle/issues/12) 🔍 Does 1Click storage-register NEAR recipients on USDC? → record in ARCHITECTURE §11 (affects S2.8, S0.10) · 2026-11-05: **no evidence that it does**, and its low-level `ft_withdraw` intent documents the opposite hazard (a withdrawal to an account with no storage balance is not refunded). App-paid registration stays in scope; recorded in ARCHITECTURE §3.5 and §11. Docs-derived and still unconfirmed by the vendor — the partner JWT (S0.8) is what turns this into a measurement.
- [ ] **S0.10** [#13](https://github.com/MFrancis-dev/settle/issues/13) 👤 If S0.9 = no: create and fund a small storage-payer NEAR account
- [x] **S0.11** [#14](https://github.com/MFrancis-dev/settle/issues/14) 🔍 + ⛔ Pick MVP payout assets from `/v0/tokens` (e.g. USDC on NEAR + USDT/USDC on 2–3 chains) → SD-4 · 2026-11-04: SD-4 decided; ids verified from live `/v0/tokens` (ARCHITECTURE §3.2)
- [ ] **S0.12** [#15](https://github.com/MFrancis-dev/settle/issues/15) 🔍 `/v0/status` enum; top-up after `INCOMPLETE_DEPOSIT`; overpayment behaviour; deposits after deadline → update status mapping
- [ ] **S0.13** [#16](https://github.com/MFrancis-dev/settle/issues/16) 🔍 Same-asset quotes (client already holds the payout asset) and minimum amounts
- [ ] **S0.14** [#17](https://github.com/MFrancis-dev/settle/issues/17) 🔍 Current wallet selector package + NEP-413 sign-message support (then add wallet + NEAR JS deps to package.json)
- [x] **S0.15** [#18](https://github.com/MFrancis-dev/settle/issues/18) Scaffold full folder structure: every file from `project_structure.md` as a stub with its roadmap id, data models drafted · 2026-11-04
- [ ] **S0.16** [#97](https://github.com/MFrancis-dev/settle/issues/97) 13 pre-existing files are not prettier-formatted (the command was never run on them). Format them in one no-behavior-change commit and decide whether CI should gate `pnpm exec prettier --check .`.

## Phase 1 — Core logic `lib/core` (Nov 5–6)

- [x] **S1.1** [#19](https://github.com/MFrancis-dev/settle/issues/19) `money.ts`: base-unit conversion, formatting, round half-up · tests incl. 0, 1 unit, large · 2026-11-04: bigint throughout, `roundHalfUp` by integer remainder, 0/6/18-decimal and 39-digit cases covered (16 tests)
- [x] **S1.2** [#20](https://github.com/MFrancis-dev/settle/issues/20) `invoice.ts`: line math, totals, invoice numbering · tests · 2026-11-04: line = `quantity` (4 dp ticks) × `unitPrice` rounded half-up; total = sum of rounded lines; numbering per SD-6 (15 tests)
- [x] **S1.3** [#21](https://github.com/MFrancis-dev/settle/issues/21) (2026-11-04: unions + 1Click→attempt mapping written; `canTransition`/`deriveInvoiceStatus` stubbed) `status.ts`: unions, 1Click → attempt/invoice mapping, monotonic transitions, overpaid & paid-after-cancel rules · tests for every status · 2026-11-04: transition table asserted over all 64 pairs, terminal states absorbing, `expired` only from `awaiting_deposit`, derivation covers overpaid / paid-after-cancel / keep-paid (19 tests)
- [x] **S1.4** [#22](https://github.com/MFrancis-dev/settle/issues/22) `address.ts`: validators for every MVP payout + refund chain · valid/invalid tests · 2026-11-04: NEAR id, EVM (EIP-55 via `@noble/hashes`), Solana (base58 → 32 bytes via `bs58`) for near/ethereum/base/arbitrum/solana; an unsupported chain is rejected, not waved through (12 tests) · **BTC/TON and other origin-only chains still have no validator** → [#100](https://github.com/MFrancis-dev/settle/issues/100)
- [x] **S1.5** [#23](https://github.com/MFrancis-dev/settle/issues/23) (2026-11-04: interfaces drafted) `adapters.ts`: `QuoteProvider`, `StatusProvider` interfaces · 2026-11-04: contract documented, `dry` recorded as a request flag rather than a mode
- [x] **S1.6** [#24](https://github.com/MFrancis-dev/settle/issues/24) (2026-11-04: payout, invoice, pay-quote schemas drafted) `schemas.ts`: zod schemas for all API bodies · 2026-11-04: added submit-tx, sign-in and demo bodies; payout schema runs the address validator and the typed-twice match (12 tests)
- [ ] **S1.7** [#100](https://github.com/MFrancis-dev/settle/issues/100) `address.ts`: validators (or an accept-with-warning decision) for origin chains outside SD-4 — BTC, TON, Tron — needed for `refundTo` · blocked on #15

## Phase 2 — Integrations (Nov 5–7)

- [x] **S2.1** [#25](https://github.com/MFrancis-dev/settle/issues/25) `lib/oneclick/client.ts` + `tokens.ts` (10-min cache) · 2026-11-05: our own `fetch` + zod boundary instead of the SDK's axios services (no injection point → tests could not run offline, AGENTS.md §8); paths/keys/bodies copied from SDK 0.1.26, its enums reused as `z.nativeEnum` so parsed values need no cast. Token cache is per-asset, TTL-checked on read, injectable clock. 22 tests (`client.test.ts`, `tokens.test.ts`).
- [x] **S2.2** [#26](https://github.com/MFrancis-dev/settle/issues/26) `quote.ts`: build `EXACT_OUTPUT` quote, dry + real, `verifyQuoteSignature()` · 2026-11-05: `requestInvoiceQuote()` verifies through the vendor's own `verifyQuoteSignature()` and **throws before returning** when a real quote fails — a `depositAddress` cannot be handed to a caller it never reaches. `dry` keeps the address (preview only) and never enters the DB path. 400 with `try at least <baseUnits>` is lifted onto `OneClickError.minimumBaseUnits` (S0.13's minimums answer). 15 tests.
- [x] **S2.3** [#27](https://github.com/MFrancis-dev/settle/issues/27) `status.ts`: `/v0/status`, `/v0/deposit/submit` · 2026-11-05: status read + `swapDetails` normalisation, `submitDepositTx` (omits `memo` when null — a memo-less chain must not send an empty string). Unknown status → `malformed_response`, never a silent map. 24 tests.
- [x] **S2.4** [#28](https://github.com/MFrancis-dev/settle/issues/28) Recorded fixtures for every status + valid/tampered signatures · 2026-11-05: `__fixtures__/{quote-real,quote-dry,statuses,tokens}.json` cover all seven statuses with real per-status money figures. **Not live recordings** — shaped from SDK 0.1.26 and re-signed in-test by a throwaway ed25519 key (`__fixtures__/signing.ts`), which gives both halves of what S2.4 asks: a signature the vendor's verifier accepts, and one that stops verifying when a signed field is edited. Needs S0.8's JWT to replace.
- [x] **S2.5** [#29](https://github.com/MFrancis-dev/settle/issues/29) `lib/near/nep413.ts`: verify signed messages (nonce, recipient, freshness) · 2026-11-05: verifies the ed25519 signature over `sha256("near:" + payload)` using the **exact bytes the wallet signed** (never a re-serialisation), then recipient, ≥32-byte nonce, `meta.timestamp` freshness, and binding to the account's own access keys. Returns a reason code, not a throw, so a login handler can 401 without leaking. 🔍 the published standard is Borsh + a 4-byte tag; this is the JSON shape Near Intents logins use — documented in the file header, fails closed. 20 tests.
- [x] **S2.6** [#30](https://github.com/MFrancis-dev/settle/issues/30) `lib/near/rpc.ts`: `storage_balance_of` · 2026-11-05: read-only RPC with a required URL (nothing can point demo mode at a funded network), the base64 double-decode of `call_function`, `view_access_key_list` for S2.5's key binding, and a typed `NearRpcError` kind per failure. A non-JSON body is now an `unexpected_result` instead of a crash. 14 tests.
- [x] **S2.7** [#31](https://github.com/MFrancis-dev/settle/issues/31) `lib/db/schema.ts` (users, payout_destinations, invoices, invoice_items, payment_attempts) + first migration · 2026-11-04: all 5 tables drafted in the scaffold; migration generated with `pnpm db:generate` → `drizzle/0000_hard_kabuki.sql`, applied and queried on both engines under S0.5
- [x] **S2.8** [#32](https://github.com/MFrancis-dev/settle/issues/32) `lib/near/storage.ts`: register USDC storage for payout accounts (skip if S0.9 = yes) · 2026-11-05: S0.9 came back "1Click does not do it", so this stays. `checkStorageRequirement` reads the contract's own `storage_balance_bounds.min` (never a hardcoded constant) + the account balance; an account that does not exist yet counts as unregistered because a payout address is valid before it is funded. Read-only by design — the spend is S2.10. 12 tests.
- [x] **S2.9** [#33](https://github.com/MFrancis-dev/settle/issues/33) `lib/db/queries/*` per table · 2026-11-05: users, payout destinations (+change log), invoices (+items, numbering under the unique index with conflict retry), payment attempts. `createPaymentAttempt` refuses a dry quote or a missing address, so no row can point a client at nowhere; `recordAttemptStatus` is idempotent on a re-report and **throws** on a backward move. 45 tests against real PGlite with the real migration applied.
- [!] **S2.10** new · `storage_deposit` **send** path: sign and submit from `STORAGE_PAYER`, plus the UI's cost confirmation. `buildStorageDepositAction()` already produces the payload. Blocked on S0.10 (a funded payer account) and S0.14 (NEAR signing dep), and it moves real funds from a real account, so it needs an explicit human "yes" (AGENTS.md §7) — deliberately not shipped inside Phase 2.

## Phase 3 — API routes (Nov 6–7)

- [ ] **S3.1** [#34](https://github.com/MFrancis-dev/settle/issues/34) `POST /api/session`, `GET /api/me`, session cookie, `middleware.ts`
- [ ] **S3.2** [#35](https://github.com/MFrancis-dev/settle/issues/35) `PUT /api/payout` with fresh NEP-413 + change log + storage registration
- [ ] **S3.3** [#36](https://github.com/MFrancis-dev/settle/issues/36) Invoices: create, list, detail, cancel
- [ ] **S3.4** [#37](https://github.com/MFrancis-dev/settle/issues/37) Public: `GET /api/pay/:publicId`, `GET /api/tokens`
- [ ] **S3.5** [#38](https://github.com/MFrancis-dev/settle/issues/38) `POST /api/pay/:publicId/quote` (dry + real, one active attempt, rate limit)
- [ ] **S3.6** [#39](https://github.com/MFrancis-dev/settle/issues/39) `submit-tx`, `status`
- [ ] **S3.7** [#40](https://github.com/MFrancis-dev/settle/issues/40) Receipts + `GET /api/export.csv`
- [ ] **S3.8** [#41](https://github.com/MFrancis-dev/settle/issues/41) Route tests: happy + validation + auth for each

## Phase 4 — UI (Nov 7–9)

- [ ] **S4.1** [#42](https://github.com/MFrancis-dev/settle/issues/42) Layout, landing page, wallet sign-in
- [ ] **S4.2** [#43](https://github.com/MFrancis-dev/settle/issues/43) Settings: payout destination form (typed twice, chain name), change log
- [ ] **S4.3** [#44](https://github.com/MFrancis-dev/settle/issues/44) Invoice create (line items) + list + detail
- [ ] **S4.4** [#45](https://github.com/MFrancis-dev/settle/issues/45) Pay page: token picker, refund address, dry preview, "Get payment address", deposit panel (QR, copy, countdown, fee), short-payment warning
- [ ] **S4.5** [#46](https://github.com/MFrancis-dev/settle/issues/46) Pay page states: awaiting, detected, processing, paid, underpaid, overpaid, refunded, failed, expired, cancelled
- [ ] **S4.6** [#47](https://github.com/MFrancis-dev/settle/issues/47) Receipt page (printable)
- [ ] **S4.7** [#48](https://github.com/MFrancis-dev/settle/issues/48) Dashboard: totals, attention list, activity
- [ ] **S4.8** [#49](https://github.com/MFrancis-dev/settle/issues/49) Mobile + accessibility pass on the pay page

## Phase 5 — Worker (Nov 8)

- [ ] **S5.1** [#50](https://github.com/MFrancis-dev/settle/issues/50) `worker/index.ts` with graceful shutdown
- [ ] **S5.2** [#51](https://github.com/MFrancis-dev/settle/issues/51) `pollPayments` (5 s) · one-tick tests with fake deps
- [ ] **S5.3** [#52](https://github.com/MFrancis-dev/settle/issues/52) `expireQuotes` (60 s) · tests

## Phase 6 — Demo mode & dry-run (Nov 9–10)

- [ ] **S6.1** [#53](https://github.com/MFrancis-dev/settle/issues/53) Demo adapters (`lib/oneclick/demo.ts`) behind the interfaces
- [ ] **S6.2** [#54](https://github.com/MFrancis-dev/settle/issues/54) `seed-demo.ts`: fictional freelancer, invoices in every status, payout history
- [ ] **S6.3** [#55](https://github.com/MFrancis-dev/settle/issues/55) `pnpm demo`: PGlite + seed + demo session + banner; real dry quotes online, fixtures offline
- [ ] **S6.4** [#56](https://github.com/MFrancis-dev/settle/issues/56) "Simulate payment" walks an invoice through all statuses
- [ ] **S6.5** [#57](https://github.com/MFrancis-dev/settle/issues/57) Fresh-clone check: `git clone` → `pnpm i` → `pnpm demo` with no `.env`
- [ ] **S6.6** [#58](https://github.com/MFrancis-dev/settle/issues/58) Playwright journey = PRD §8 steps 1–5, in CI

## Phase 7 — Hardening & edge cases (Nov 10–11)

- [ ] **S7.1** [#59](https://github.com/MFrancis-dev/settle/issues/59) Exchange short-payment warning + underpaid screen (top-up or refund per S0.12)
- [ ] **S7.2** [#60](https://github.com/MFrancis-dev/settle/issues/60) Paid twice / overpaid flow with both attempts listed
- [ ] **S7.3** [#61](https://github.com/MFrancis-dev/settle/issues/61) Paid after cancel
- [ ] **S7.4** [#62](https://github.com/MFrancis-dev/settle/issues/62) Same-asset case (per S0.13)
- [ ] **S7.5** [#63](https://github.com/MFrancis-dev/settle/issues/63) Memo-chain refund warning
- [ ] **S7.6** [#64](https://github.com/MFrancis-dev/settle/issues/64) Minimum invoice amount (per S0.13)
- [ ] **S7.7** [#65](https://github.com/MFrancis-dev/settle/issues/65) Rate limits on quote/status routes
- [ ] **S7.8** [#66](https://github.com/MFrancis-dev/settle/issues/66) Payout-change security: fresh signature, banner, snapshot per attempt
- [ ] **S7.9** [#67](https://github.com/MFrancis-dev/settle/issues/67) Error states: 1Click down, no route, region not served
- [ ] **S7.10** [#68](https://github.com/MFrancis-dev/settle/issues/68) Logs contain no secrets or client PII

## Phase 8 — Deploy & real run (Nov 11)

- [ ] **S8.1** [#69](https://github.com/MFrancis-dev/settle/issues/69) 👤 Pick hosting (web, worker, Postgres) and create accounts
- [ ] **S8.2** [#70](https://github.com/MFrancis-dev/settle/issues/70) 👤 Set production env vars
- [ ] **S8.3** [#71](https://github.com/MFrancis-dev/settle/issues/71) Deploy; hosted demo mode reachable
- [ ] **S8.4** [#72](https://github.com/MFrancis-dev/settle/issues/72) 👤 Approve and do one small real payment end-to-end; record tx links
- [ ] **S8.5** [#73](https://github.com/MFrancis-dev/settle/issues/73) Fix anything the real run exposed

## Phase 9 — README & public repo (Nov 11–12)

- [ ] **S9.1** [#74](https://github.com/MFrancis-dev/settle/issues/74) README: what it is, the problem, how NEAR Intents is used (concretely), "do X → see Y" steps, demo URL
- [ ] **S9.2** [#75](https://github.com/MFrancis-dev/settle/issues/75) README: architecture summary, no-custody statement, limitations
- [ ] **S9.3** [#76](https://github.com/MFrancis-dev/settle/issues/76) README: libraries and templates used; statement that code was written in the hackathon window
- [~] **S9.4** [#77](https://github.com/MFrancis-dev/settle/issues/77) (2026-11-04: README links the Stack repo; keep it in the final README) README names **Stack** as the team's other, independent project (Q-015)
- [ ] **S9.5** [#78](https://github.com/MFrancis-dev/settle/issues/78) LICENSE present; `.env.example` complete; no secrets in history (gitleaks)
- [x] **S9.6** [#79](https://github.com/MFrancis-dev/settle/issues/79) 👤 Make the repo public · 2026-11-04: public from creation; must stay public through judging (Q-014)
- [ ] **S9.7** [#80](https://github.com/MFrancis-dev/settle/issues/80) Fresh-clone check again from the public URL

## Phase 10 — Launch (Nov 12–13)

- [ ] **S10.1** [#81](https://github.com/MFrancis-dev/settle/issues/81) Demo video script: user problem → one full payment → NEAR's role → next step
- [ ] **S10.2** [#82](https://github.com/MFrancis-dev/settle/issues/82) 👤 Record the video (real payment from S8.4 + demo mode)
- [ ] **S10.3** [#83](https://github.com/MFrancis-dev/settle/issues/83) Draft the X post (problem first, NEAR's concrete role, repo + demo links, @NEARProtocol #NEARHackathon, optional @NearLegion @NearBuilders)
- [ ] **S10.4** [#84](https://github.com/MFrancis-dev/settle/issues/84) 👤 Publish the post; paste its URL here
- [ ] **S10.5** [#85](https://github.com/MFrancis-dev/settle/issues/85) Re-read live HACKATHON.md for rule changes
- [ ] **S10.6** [#86](https://github.com/MFrancis-dev/settle/issues/86) Draft submission payload (track `realworld`); print it for the human
- [ ] **S10.7** [#87](https://github.com/MFrancis-dev/settle/issues/87) 👤 Confirm payload; submit once (keep `requestId` for retries); record the 201

## Phase 11 — After submission (Nov 14–25)

- [ ] **S11.1** [#88](https://github.com/MFrancis-dev/settle/issues/88) Keep the hosted demo up until at least Nov 18 (ideally Nov 25)
- [ ] **S11.2** [#89](https://github.com/MFrancis-dev/settle/issues/89) Keep the repo public through judging; no breaking changes to the demo
- [ ] **S11.3** [#90](https://github.com/MFrancis-dev/settle/issues/90) Watch Discord/X for judge questions

---

## Stretch (only after Phase 10 is done or explicitly approved)
- [ ] On-chain receipt registry contract (`contracts/receipts/`)
- [ ] EVM wallet connect on the pay page
- [ ] Recurring invoices · email notifications · EUR/GBP invoices · PDF export
- [ ] 1Click `appFees` business model

---

## Update log
One line per contribution, newest first: `YYYY-MM-DD · who/agent · what changed · tasks`

- 2026-11-05 · agent · Built Phase 2 (1Click + NEAR + DB reads, all offline): `lib/oneclick/{client,tokens,quote,status}.ts` on our own `fetch` + zod boundary with the SDK's verifier still authoritative for quotes; `lib/near/{nep413,rpc,storage}.ts`; `lib/db/queries/*` for all five tables. Fixtures for all seven statuses + in-test re-signing. S0.9, S0.12 (partly) and S0.13's minimums answered from the docs and recorded in ARCHITECTURE. **152 new tests in 11 files; the suite is now 236 passing + 1 skipped (Postgres-only), typecheck and lint clean.** Four incidental defects found by tests and fixed at the root: `money.ts` capped decimals at 18 so every yoctoNEAR (24 dp) amount threw; `rpc.ts` called `response.json()` on a body that may not be JSON; `nep413.ts` double-hashed when a wallet sent `prehash` and parsed an untrusted payload unguarded; `storage.ts` asked for a full `minimum` top-up even for a partially registered account. Also `invoices.ts` now trims Postgres's padded `numeric(18,4)` quantity on read. Added `@noble/curves` (README, rule Q-005). Filed S2.10 for the `storage_deposit` send path instead of shipping a fund-moving transaction unreviewed · S0.9, S2.1–S2.6, S2.8, S2.9, new S2.10
- 2026-11-04 · agent · Phase 1 core logic built: `money.ts` bigint base units + half-up, `invoice.ts` line math/totals/numbering (SD-6), `status.ts` monotonic attempt transitions + invoice derivation, `address.ts` NEAR/EIP-55/Solana validators, `schemas.ts` for every API body; 74 unit tests, each rule mutation-checked; `@noble/hashes` + `bs58` added (SD-7, listed in README) · S1.1–S1.6, S1.7 filed
- 2026-11-04 · agent · Finished the Phase 0 build-out: `lib/db/client.ts` opens + migrates PGlite or Postgres (query proven on both, Postgres via a throwaway local instance), env parsing moved to `lib/server/env-schema.ts` because `server-only` throws under `tsx` (it would have broken `pnpm demo`), `check-env` reports missing names and exits 1 for real mode, CI workflow added (typecheck/lint/test/build + gitleaks v8.30.1). Fixed `pnpm lint` (was linting generated `next-env.d.ts`) and `pnpm format` (errored on generated `drizzle/*.sql` — added `.prettierignore`). Generated `drizzle/0000_hard_kabuki.sql`. 11 tests now pass, up from 0. · S0.5, S0.6, S0.7, S2.7, new S0.16
- 2026-11-04 · agent · Rewrote `main` history (approved force-push) to drop tool attribution lines from commit messages; every commit's files unchanged · —
- 2026-11-04 · agent · Decisions accepted by the human: SD-4 payout assets, SD-5 name Settle; payout asset ids recorded; update-log actor made neutral · S0.1, S0.11
- 2026-11-04 · agent · Created public repo MFrancis-dev/settle and pushed; GitHub labels, phase milestones and one issue per ROADMAP task, decision, stretch item + a hackathon-rules compliance issue · S0.3, S9.6
- 2026-11-04 · agent · First commit (approved): README cross-links Stack, PR template with ROADMAP + hackathon-rule checklist, issue template · S0.2, S9.4
- 2026-11-04 · agent · Installed deps (pnpm 11, esbuild build approved in pnpm-workspace.yaml), pinned exact versions, ESM package, lint config allows `_` stub params; typecheck/lint/test/build all green · S0.4
- 2026-11-04 · agent · Scaffolded the repo (96 files): configs, every route/page/component/lib/worker stub with roadmap ids, Drizzle schema, core types + statuses, zod env/schemas, test todos, `git init` (no commit, deps not installed) · S0.2, S0.4–S0.6, S0.15, S1.3, S1.5, S1.6, S2.7
- 2026-11-04 · agent · Split from the combined design into its own project; wrote PRD, ARCHITECTURE, ESSENTIALS, AGENTS, CLAUDE, project_structure, ROADMAP · D
