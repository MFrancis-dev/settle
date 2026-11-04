# Project structure — Settle

> Where every file goes. **Scaffolded 2026-11-04**: every file below exists as a stub (or drafted data model). Build features inside these files; update this file when the layout changes.
> **Every contribution updates `ROADMAP.md`** (AGENTS.md §0).

## 1. Top level

```
settle/
├─ AGENTS.md                     # rules for every coding agent (source of truth)
├─ CLAUDE.md                     # Claude Code entry; imports AGENTS, ROADMAP, ESSENTIALS
├─ ROADMAP.md                    # remaining work to 100% readiness — updated on EVERY contribution
├─ PRD.md                        # what and why
├─ ARCHITECTURE.md               # full design + design review (§11)
├─ ARCHITECTURE_ESSENTIALS.md    # short reference loaded every session
├─ project_structure.md          # this file
├─ README.md                     # judges + AI screeners; names sister project Stack
├─ LICENSE                       # MIT
├─ .github/                       # pull_request_template.md (ROADMAP + hackathon-rule checklist), ISSUE_TEMPLATE/roadmap-task.md
├─ .env.example                  # names only
├─ .gitignore
├─ package.json                  # scripts: dev, worker, demo, test, e2e, lint, typecheck, db:* (exact versions, ESM)
├─ pnpm-workspace.yaml · pnpm-lock.yaml   # pnpm 11 settings (allowBuilds) + lockfile — commit both
├─ tsconfig.json · next.config.ts · postcss.config.mjs (Tailwind v4) · eslint.config.mjs · .prettierrc · vitest.config.ts
├─ drizzle.config.ts
├─ middleware.ts                 # session check for (dashboard)
├─ app/                          # Next.js routes (pages + API)
├─ components/                   # React components by feature
├─ lib/                          # domain logic and integrations
├─ worker/                       # background loops
├─ drizzle/                      # generated migrations — never hand-edit
├─ e2e/                          # Playwright
├─ scripts/                      # dev scripts
└─ public/
```

Import direction inside `lib/` (never the other way):
```
app/, worker/ ──► lib/server ──► lib/db, lib/oneclick, lib/near ──► lib/core
```
`lib/core` has no I/O and imports nothing else from the project.

## 2. `app/`

```
app/
├─ layout.tsx · page.tsx · globals.css      # landing: what Settle is, demo + sign in
├─ (dashboard)/
│  ├─ layout.tsx
│  ├─ dashboard/page.tsx                    # totals, attention list, recent activity
│  ├─ invoices/page.tsx                     # list
│  ├─ invoices/new/page.tsx                 # create
│  ├─ invoices/[id]/page.tsx                # detail: attempts, statuses, receipt links
│  └─ settings/page.tsx                     # profile, payout destination, change log
├─ pay/[publicId]/page.tsx                  # PUBLIC pay page — mobile first, no jargon
├─ receipt/[token]/page.tsx                 # printable receipt
├─ demo/page.tsx                            # demo entry + banner
└─ api/
   ├─ session/route.ts · me/route.ts · payout/route.ts
   ├─ invoices/route.ts · invoices/[id]/route.ts · invoices/[id]/cancel/route.ts
   ├─ tokens/route.ts
   ├─ pay/[publicId]/route.ts · pay/[publicId]/quote/route.ts
   ├─ pay/[publicId]/submit-tx/route.ts · pay/[publicId]/status/route.ts
   ├─ receipts/[attemptId]/route.ts
   ├─ export.csv/route.ts
   └─ demo/[action]/route.ts                # simulate-payment, reset
```
Route handlers stay thin: zod-validate → call `lib/` → respond.

## 3. `components/`
```
components/
├─ ui/          # shadcn/ui primitives (generated)
├─ invoice/     # InvoiceForm, LineItems, InvoiceTable, StatusBadge
├─ pay/         # TokenPicker, RefundAddressInput, DepositPanel (QR + copy), Countdown, PayStatus, ShortPaymentWarning
├─ payout/      # PayoutForm (typed twice, chain name), PayoutChangeLog
├─ receipt/     # Receipt
└─ wallet/      # WalletProvider, SignInButton
```

## 4. `lib/`
```
lib/
├─ core/            # pure: money.ts, status.ts (unions + 1Click mapping + transitions),
│                   # invoice.ts (line math), address.ts (per-chain validators), adapters.ts, schemas.ts
├─ oneclick/        # client.ts, tokens.ts (cache), quote.ts (build + verify), status.ts, demo.ts, __fixtures__/
├─ near/            # nep413.ts (verify), storage.ts (check + register USDC storage), rpc.ts
├─ db/              # schema.ts, client.ts (PGlite or Postgres by DATABASE_URL), queries/, seed-demo.ts
└─ server/          # SERVER ONLY: env.ts (zod), session.ts, adapters.ts (real vs demo), rateLimit.ts
```
Tests sit next to source as `*.test.ts`.

## 5. `worker/`
```
worker/
├─ index.ts                 # start loops, graceful shutdown
├─ pollPayments.ts          # 5 s
└─ expireQuotes.ts          # 60 s
```
Each loop is `(deps) => Promise<void>` so tests can run one tick with fake deps.

## 6. `e2e/`, `scripts/`
```
e2e/playwright.config.ts · e2e/demo-journey.spec.ts   # PRD §8
scripts/seed-demo.ts · scripts/check-env.ts            # check-env prints missing names, never values
```

## 7. Where does X go?
| Adding… | Put it in |
|---|---|
| Money math | `lib/core/money.ts` + test |
| Status / mapping | `lib/core/status.ts` |
| Address rule for a chain | `lib/core/address.ts` |
| 1Click call | `lib/oneclick/` |
| NEAR RPC / NEP-413 / storage | `lib/near/` |
| Table or column | `lib/db/schema.ts` → `pnpm db:generate` |
| Freelancer page | `app/(dashboard)/…` |
| Anything a client sees | `app/pay/…` + `components/pay/` |
| Background job | `worker/` |
| Secret / config | `.env` + `.env.example` + `lib/server/env.ts` |
| Demo behaviour | `lib/oneclick/demo.ts` / `lib/db/seed-demo.ts` |
| Stretch receipt contract | `contracts/receipts/` (only when ROADMAP says so) |

## 8. Naming
TS `camelCase.ts`, components `PascalCase.tsx`, routes `kebab-case`, DB `snake_case` plural tables, timestamps `_at`, env `SCREAMING_SNAKE_CASE`.

## 9. Never commit
`.env*` (except `.env.example`), `node_modules/`, `.next/`, local DB files (`*.db`, `pglite/`), `coverage/`, `playwright-report/`, keys.
