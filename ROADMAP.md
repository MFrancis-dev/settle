# ROADMAP — Settle (track 08 · `realworld`)

> All remaining work to get this repo to **100% readiness** (submitted, public, demoable, judged-ready).
> **Every contribution updates this file in the same change** (AGENTS.md §0): task status, phase %, Readiness table, Blockers if any, and one Update-log line.
> Deadline: **2026-11-14 23:59 UTC**. Target submission: **2026-11-13** (one day of buffer; sister project Stack submits on the 14th).

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done (add date) · `[!]` blocked (reason in Blockers) · `[-]` dropped (reason) · 👤 = human-only task · 🔍 = verify in docs · ⛔ = needs a human decision

---

## Readiness

| Phase | Target dates | Progress | Status |
|---|---|---|---|
| D. Design & docs | Nov 4 | 100% | ✅ done |
| 0. Setup & verification | Nov 4–5 | 13% | in progress |
| 1. Core logic (`lib/core`) | Nov 5–6 | 0% | in progress (drafted) |
| 2. Integrations (1Click, NEAR, DB) | Nov 5–7 | 0% | in progress (schema drafted) |
| 3. API routes | Nov 6–7 | 0% | not started |
| 4. UI | Nov 7–9 | 0% | not started |
| 5. Worker | Nov 8 | 0% | not started |
| 6. Demo mode & dry-run | Nov 9–10 | 0% | not started |
| 7. Hardening & edge cases | Nov 10–11 | 0% | not started |
| 8. Deploy & real run | Nov 11 | 0% | not started |
| 9. README & public repo | Nov 11–12 | 0% | not started |
| 10. Launch: video, post, submission | Nov 12–13 | 0% | not started |
| 11. After submission | Nov 14–25 | 0% | not started |
| **Overall (MVP)** | | **~9%** | |

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

_None yet._ Format: `- [task id] what blocks it · who can unblock · since date`

## Decisions

| ID | Decision | Status |
|---|---|---|
| SD-1 | No contract in MVP; receipt registry = stretch | ✅ decided |
| SD-2 | No custody, no relayer | ✅ decided |
| SD-3 | Single Next.js app + worker; PGlite local/demo, Postgres hosted | ✅ decided |
| SD-4 | Payout assets offered in MVP (which stablecoins/chains) | ⛔ open → decide in S0.11 |
| SD-5 | Working name "Settle" final? | ⛔ open → S0.1 |

---

## Phase 0 — Setup & verification (Nov 4–5)

- [ ] **S0.1** 👤 Confirm product name (or pick a new one) · _done when_: name used in README/package.json
- [x] **S0.2** `git init`, `.gitignore`, MIT `LICENSE`, README stub that names Stack · _done when_: first commit exists (👤 approves commit) · 2026-11-04: first commit approved and made; README links Stack; PR + issue templates added
- [ ] **S0.3** 👤 Create a **private** GitHub repo and add the remote (goes public in S9.6)
- [x] **S0.4** (2026-11-04: installed with pnpm 11.17, exact versions pinned (Next 15.5.28, zod 3.25.76, Drizzle 0.36.4, PGlite 0.2.17, 1Click SDK 0.1.26); typecheck, lint, test (11 todo) and `next build` (15 pages, 14 API routes) all pass) Scaffold Next.js 15 + TS strict + Tailwind + shadcn/ui + ESLint/Prettier + vitest + Playwright; scripts named as in AGENTS.md §5 · _done when_: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck` run
- [~] **S0.5** (2026-11-04: `drizzle.config.ts` switch written; `lib/db/client.ts` stub) Drizzle with PGlite (no `DATABASE_URL`) / Postgres (with it) · _done when_: a test query runs on both
- [~] **S0.6** `lib/server/env.ts` (zod), `.env.example`, `scripts/check-env.ts` · 2026-11-04: env.ts + .env.example done; check-env stub
- [ ] **S0.7** CI: GitHub Actions running typecheck, lint, test; secret scanning (gitleaks)
- [ ] **S0.8** 👤 Register a 1Click partner JWT (partners.near-intents.org) and put it in `.env`
- [ ] **S0.9** 🔍 Does 1Click storage-register NEAR recipients on USDC? → record in ARCHITECTURE §11 (affects S2.8, S0.10)
- [ ] **S0.10** 👤 If S0.9 = no: create and fund a small storage-payer NEAR account
- [ ] **S0.11** 🔍 + ⛔ Pick MVP payout assets from `/v0/tokens` (e.g. USDC on NEAR + USDT/USDC on 2–3 chains) → SD-4
- [ ] **S0.12** 🔍 `/v0/status` enum; top-up after `INCOMPLETE_DEPOSIT`; overpayment behaviour; deposits after deadline → update status mapping
- [ ] **S0.13** 🔍 Same-asset quotes (client already holds the payout asset) and minimum amounts
- [ ] **S0.14** 🔍 Current wallet selector package + NEP-413 sign-message support (then add wallet + NEAR JS deps to package.json)
- [x] **S0.15** Scaffold full folder structure: every file from `project_structure.md` as a stub with its roadmap id, data models drafted · 2026-11-04

## Phase 1 — Core logic `lib/core` (Nov 5–6)

- [ ] **S1.1** `money.ts`: base-unit conversion, formatting, round half-up · tests incl. 0, 1 unit, large
- [ ] **S1.2** `invoice.ts`: line math, totals, invoice numbering · tests
- [~] **S1.3** (2026-11-04: unions + 1Click→attempt mapping written; `canTransition`/`deriveInvoiceStatus` stubbed) `status.ts`: unions, 1Click → attempt/invoice mapping, monotonic transitions, overpaid & paid-after-cancel rules · tests for every status
- [ ] **S1.4** `address.ts`: validators for every MVP payout + refund chain · valid/invalid tests
- [~] **S1.5** (2026-11-04: interfaces drafted) `adapters.ts`: `QuoteProvider`, `StatusProvider` interfaces
- [~] **S1.6** (2026-11-04: payout, invoice, pay-quote schemas drafted) `schemas.ts`: zod schemas for all API bodies

## Phase 2 — Integrations (Nov 5–7)

- [ ] **S2.1** `lib/oneclick/client.ts` + `tokens.ts` (10-min cache)
- [ ] **S2.2** `quote.ts`: build `EXACT_OUTPUT` quote, dry + real, `verifyQuoteSignature()`
- [ ] **S2.3** `status.ts`: `/v0/status`, `/v0/deposit/submit`
- [ ] **S2.4** Recorded fixtures for every status + valid/tampered signatures
- [ ] **S2.5** `lib/near/nep413.ts`: verify signed messages (nonce, recipient, freshness)
- [ ] **S2.6** `lib/near/rpc.ts`: `storage_balance_of`
- [~] **S2.7** (2026-11-04: all 5 tables written; migration not generated) `lib/db/schema.ts` (users, payout_destinations, invoices, invoice_items, payment_attempts) + first migration
- [ ] **S2.8** `lib/near/storage.ts`: register USDC storage for payout accounts (skip if S0.9 = yes)
- [ ] **S2.9** `lib/db/queries/*` per table

## Phase 3 — API routes (Nov 6–7)

- [ ] **S3.1** `POST /api/session`, `GET /api/me`, session cookie, `middleware.ts`
- [ ] **S3.2** `PUT /api/payout` with fresh NEP-413 + change log + storage registration
- [ ] **S3.3** Invoices: create, list, detail, cancel
- [ ] **S3.4** Public: `GET /api/pay/:publicId`, `GET /api/tokens`
- [ ] **S3.5** `POST /api/pay/:publicId/quote` (dry + real, one active attempt, rate limit)
- [ ] **S3.6** `submit-tx`, `status`
- [ ] **S3.7** Receipts + `GET /api/export.csv`
- [ ] **S3.8** Route tests: happy + validation + auth for each

## Phase 4 — UI (Nov 7–9)

- [ ] **S4.1** Layout, landing page, wallet sign-in
- [ ] **S4.2** Settings: payout destination form (typed twice, chain name), change log
- [ ] **S4.3** Invoice create (line items) + list + detail
- [ ] **S4.4** Pay page: token picker, refund address, dry preview, "Get payment address", deposit panel (QR, copy, countdown, fee), short-payment warning
- [ ] **S4.5** Pay page states: awaiting, detected, processing, paid, underpaid, overpaid, refunded, failed, expired, cancelled
- [ ] **S4.6** Receipt page (printable)
- [ ] **S4.7** Dashboard: totals, attention list, activity
- [ ] **S4.8** Mobile + accessibility pass on the pay page

## Phase 5 — Worker (Nov 8)

- [ ] **S5.1** `worker/index.ts` with graceful shutdown
- [ ] **S5.2** `pollPayments` (5 s) · one-tick tests with fake deps
- [ ] **S5.3** `expireQuotes` (60 s) · tests

## Phase 6 — Demo mode & dry-run (Nov 9–10)

- [ ] **S6.1** Demo adapters (`lib/oneclick/demo.ts`) behind the interfaces
- [ ] **S6.2** `seed-demo.ts`: fictional freelancer, invoices in every status, payout history
- [ ] **S6.3** `pnpm demo`: PGlite + seed + demo session + banner; real dry quotes online, fixtures offline
- [ ] **S6.4** "Simulate payment" walks an invoice through all statuses
- [ ] **S6.5** Fresh-clone check: `git clone` → `pnpm i` → `pnpm demo` with no `.env`
- [ ] **S6.6** Playwright journey = PRD §8 steps 1–5, in CI

## Phase 7 — Hardening & edge cases (Nov 10–11)

- [ ] **S7.1** Exchange short-payment warning + underpaid screen (top-up or refund per S0.12)
- [ ] **S7.2** Paid twice / overpaid flow with both attempts listed
- [ ] **S7.3** Paid after cancel
- [ ] **S7.4** Same-asset case (per S0.13)
- [ ] **S7.5** Memo-chain refund warning
- [ ] **S7.6** Minimum invoice amount (per S0.13)
- [ ] **S7.7** Rate limits on quote/status routes
- [ ] **S7.8** Payout-change security: fresh signature, banner, snapshot per attempt
- [ ] **S7.9** Error states: 1Click down, no route, region not served
- [ ] **S7.10** Logs contain no secrets or client PII

## Phase 8 — Deploy & real run (Nov 11)

- [ ] **S8.1** 👤 Pick hosting (web, worker, Postgres) and create accounts
- [ ] **S8.2** 👤 Set production env vars
- [ ] **S8.3** Deploy; hosted demo mode reachable
- [ ] **S8.4** 👤 Approve and do one small real payment end-to-end; record tx links
- [ ] **S8.5** Fix anything the real run exposed

## Phase 9 — README & public repo (Nov 11–12)

- [ ] **S9.1** README: what it is, the problem, how NEAR Intents is used (concretely), "do X → see Y" steps, demo URL
- [ ] **S9.2** README: architecture summary, no-custody statement, limitations
- [ ] **S9.3** README: libraries and templates used; statement that code was written in the hackathon window
- [~] **S9.4** (2026-11-04: README links the Stack repo; keep it in the final README) README names **Stack** as the team's other, independent project (Q-015)
- [ ] **S9.5** LICENSE present; `.env.example` complete; no secrets in history (gitleaks)
- [ ] **S9.6** 👤 Make the repo public
- [ ] **S9.7** Fresh-clone check again from the public URL

## Phase 10 — Launch (Nov 12–13)

- [ ] **S10.1** Demo video script: user problem → one full payment → NEAR's role → next step
- [ ] **S10.2** 👤 Record the video (real payment from S8.4 + demo mode)
- [ ] **S10.3** Draft the X post (problem first, NEAR's concrete role, repo + demo links, @NEARProtocol #NEARHackathon, optional @NearLegion @NearBuilders)
- [ ] **S10.4** 👤 Publish the post; paste its URL here
- [ ] **S10.5** Re-read live HACKATHON.md for rule changes
- [ ] **S10.6** Draft submission payload (track `realworld`); print it for the human
- [ ] **S10.7** 👤 Confirm payload; submit once (keep `requestId` for retries); record the 201

## Phase 11 — After submission (Nov 14–25)

- [ ] **S11.1** Keep the hosted demo up until at least Nov 18 (ideally Nov 25)
- [ ] **S11.2** Keep the repo public through judging; no breaking changes to the demo
- [ ] **S11.3** Watch Discord/X for judge questions

---

## Stretch (only after Phase 10 is done or explicitly approved)
- [ ] On-chain receipt registry contract (`contracts/receipts/`)
- [ ] EVM wallet connect on the pay page
- [ ] Recurring invoices · email notifications · EUR/GBP invoices · PDF export
- [ ] 1Click `appFees` business model

---

## Update log
One line per contribution, newest first: `YYYY-MM-DD · who/agent · what changed · tasks`

- 2026-11-04 · Claude · First commit (approved): README cross-links Stack, PR template with ROADMAP + hackathon-rule checklist, issue template · S0.2, S9.4
- 2026-11-04 · Claude · Installed deps (pnpm 11, esbuild build approved in pnpm-workspace.yaml), pinned exact versions, ESM package, lint config allows `_` stub params; typecheck/lint/test/build all green · S0.4
- 2026-11-04 · Claude · Scaffolded the repo (96 files): configs, every route/page/component/lib/worker stub with roadmap ids, Drizzle schema, core types + statuses, zod env/schemas, test todos, `git init` (no commit, deps not installed) · S0.2, S0.4–S0.6, S0.15, S1.3, S1.5, S1.6, S2.7
- 2026-11-04 · Claude · Split from the combined design into its own project; wrote PRD, ARCHITECTURE, ESSENTIALS, AGENTS, CLAUDE, project_structure, ROADMAP · D
