# Deploying Settle (Phase 8 preparation)

What a host has to provide, the one decision that was blocking it, and the evidence behind both.
**Nothing has been deployed and no vendor manifest is committed**: picking the host is S8.1 and is
👤 the human's, and an untested `render.yaml` or `Dockerfile` in the repo would read as a claim that
it works.

Everything in §2–§5 was measured on 2026-11-08 against the installed dependencies and a throwaway
PostgreSQL 16.15, not taken from documentation. §6 is the exception: it is quoted from the vendors'
own pages on the same date, is cited line by line, and is not a measurement. §2 is the constraint
that decides the database; §3 is the decision the human made about demo mode, and what was verified
locally once it was made.

---

## 1. What has to run

| Process  | Command       | Lifetime                | Notes                                                       |
| -------- | ------------- | ----------------------- | ----------------------------------------------------------- |
| Web      | `pnpm start`  | long-lived, serves HTTP | `next start`; build with `pnpm build`                       |
| Worker   | `pnpm worker` | long-lived, polls       | moves attempts forward when nobody is watching the pay page |
| Database | —             | —                       | Postgres for anything hosted; see §2                        |

The worker is the constraint that rules most hosting out: it is a second **long-lived process**, so
a platform that only runs request-triggered functions cannot host Settle as designed. Either pick a
host that runs a worker service alongside a web service, or run both processes on one machine under
a supervisor.

Migrations need no separate step in production. `createDatabase()` applies every pending migration
on open (`lib/db/client.ts`) using `postgres` and `drizzle-orm`, both runtime dependencies.
`drizzle-kit` is a development tool for _generating_ migration SQL and is never needed on a host.

**CI drives this exact path.** The Playwright journey runs `pnpm demo:prod` (`scripts/demo-prod.ts`),
which is `next build` then `next start` in demo mode — the two commands in the table above, not
`next dev`. So the artifact a host deploys is the artifact the e2e suite proves, on every push. The
one difference from a real deploy is the database: `demo:prod` uses embedded PGlite because it is one
process, whereas a host runs web + worker and must set `DATABASE_URL` (§2). `pnpm demo` (`next dev`)
is untouched and stays the command the README tells a judge to run.

## 2. Measured: PGlite is single-process, so a hosted Settle needs Postgres

PGlite is the embedded database Settle uses when `DATABASE_URL` is empty — locally, in the 635-test
suite, and in `pnpm demo`. All three are **one process**, which is the only shape it supports.

Two processes on one data directory were run against each other: 120 inserts each, concurrently, on
`@electric-sql/pglite` 0.2.17. The result:

- the second process to lose a race **died** with `ExitStatus: Program terminated with exit(1)` —
  the WASM Postgres aborts the whole Node process, it does not throw a catchable error;
- the survivor finished with **0 errors**, so nothing in its own log suggests a problem;
- reopening the directory afterwards showed **only the survivor's 120 rows**. The other process's
  120 writes were gone, silently.

There is no cross-process lock and no corruption error to catch. Web + worker on one PGlite
directory would therefore lose invoices or attempts, and the loss would look like a bug in the
write path rather than a deployment mistake. **Set `DATABASE_URL` for any hosted deployment.**

PGlite stays exactly right for local development, tests and demo mode, and nothing about them
changes.

**The same race on Postgres, for contrast.** The identical two-process, 120-inserts-each run against
a throwaway PostgreSQL 16.15 instance: both processes finished with **0 errors** and **all 240 rows
persisted** (120 from each). Web and worker started together also ran their migrations concurrently
and `drizzle.__drizzle_migrations` ended with **2 rows and 2 distinct hashes** for the 2 migration
files — no duplicates, so a host that starts both processes at once is safe.

One log line to expect on a first deploy, which is **not** an error:

```
NOTICE: identifier "payment_attempts_payout_destination_id_payout_destinations_id_fk"
        will be truncated to "payment_attempts_payout_destination_id_payout_destinations_id_f"
```

Postgres caps identifiers at 63 bytes and Drizzle generates that foreign-key name at 64. It is the
only identifier in the schema over the limit, and no two names collide once truncated, so the
constraint is intact under a shortened name (verified against the live catalog: 15 constraints, 12
indexes). The `postgres` driver prints server `NOTICE`s to stdout as objects, which is why it looks
like a crash.

## 3. Decided 2026-11-08: the hosted app runs real mode

`demoModeConflict()` (`lib/server/adapters.ts`) refuses to honour `DEMO_MODE` when `PUBLIC_APP_URL`
starts with `https://`, on the reasoning that a deployment which could take a real payment must never
simulate one. Nearly every host terminates TLS and hands back an `https://` URL, so **S8.3 as
originally written — "Deploy; hosted demo mode reachable" — was not achievable on a normal host.**
That was the guard working, not a bug.

Two options were put to the human:

- **(a) Host real mode.** No `DEMO_MODE`, `DATABASE_URL` set, `SESSION_SECRET` and `PUBLIC_APP_URL`
  set. Sign-in works, invoices are real rows, quotes come from 1Click. `ONECLICK_JWT` is optional
  (rule Q-006: without it a 0.2% fee applies), and a real _payment_ still needs funded accounts,
  which is S8.4 and 👤.
- **(b) Weaken the guard** so demo mode is allowed on `https://`, which would remove the invariant
  that stops a simulated payment being mistaken for a real one.

**The human chose (a)** — "follow your recommendation", 2026-11-08. Recorded as `SD-8` in
`ROADMAP.md`, and S8.3 is reworded to "Deploy real mode; the hosted app is reachable and
`/api/health` is green". The demo-mode story stays where it already works: `pnpm demo` locally, the
E2E browser journey in CI, and the video (S10.2). Nothing about the guard changes.

### Verified against a throwaway Postgres before writing this down

Real mode was booted locally against PostgreSQL 16.15 with `DATABASE_URL` set, a generated 64-character
`SESSION_SECRET`, `PUBLIC_APP_URL=http://localhost:3100`, no `DEMO_MODE`, and **no** `ONECLICK_JWT`
or `NEAR_RPC_URL` — the shape a first deploy is most likely to be in:

- `pnpm build` succeeded, and `pnpm start` plus `pnpm worker` ran **at the same time** against the
  one database; neither process died.
- `GET /api/health` answered `200 {"status":"ok","demo":false,"database":"ok"}` — `demo:false`
  confirms real mode, `database:"ok"` confirms the Postgres connection.
- Migrations applied on open with no host-side step: the five tables (`users`, `invoices`,
  `invoice_items`, `payment_attempts`, `payout_destinations`), 15 constraints and 12 indexes.
- The worker logged exactly the documented fail-closed behaviour and kept running:
  `env is missing ONECLICK_JWT, NEAR_RPC_URL — upstream reads will fail until it is set`, then
  `pollPayments every 5s, expireQuotes every 60s`. So a deploy missing those two still serves; it
  just cannot verify a signed action or read a status until they are set.

This proves the topology S8.1 has to buy: two long-lived processes and one Postgres. It is **not** a
deployment — no host, no `https://`, no accounts, nothing reachable from the internet.

## 4. Health check

`GET /api/health` — added for this phase, unauthenticated because a load balancer has no session
cookie.

```
200 {"status":"ok","demo":true,"database":"ok"}
503 {"status":"degraded","demo":false,"database":"unreachable"}
```

It answers 503, not 200, when the database cannot be read: a probe that stays green while the app
cannot open an invoice would restart nothing and tell a deployer everything is fine. The reason
goes to the server log (`health: not ok — …`); the body never carries a host name, a connection
string, a version or an upstream's state. `Cache-Control: no-store`, and it is not rate limited —
it calls no upstream API and writes nothing, so throttling it would only make a host mark a healthy
container down.

Point the host's health check at it, and use it to confirm S8.3 from the outside.

## 5. Environment variables

`.env.example` is the complete list. What a hosted deployment actually needs:

| Variable         | Needed to boot | Needed for a real payment | Notes                                              |
| ---------------- | -------------- | ------------------------- | -------------------------------------------------- |
| `DATABASE_URL`   | yes (hosted)   | yes                       | see §2 — PGlite is not an option for two processes |
| `SESSION_SECRET` | yes            | yes                       | ≥ 32 chars; without it nobody can sign in          |
| `PUBLIC_APP_URL` | yes            | yes                       | the `https://` URL; also decides cookie `Secure`   |
| `NEAR_RPC_URL`   | no             | yes                       | signed actions fail closed with `not_configured`   |
| `ONECLICK_JWT`   | no             | no                        | optional; 0.2% fee without it (Q-006)              |
| `DEMO_MODE`      | no             | never                     | must be **unset** on a host, per §3                |

`pnpm check-env` prints what is set and what is missing without echoing a secret.

## 6. Host options, read on 2026-11-08

S8.1 has to buy the shape proven in §3: **two long-lived processes and one Postgres, all reachable
for the judging window.** Judging starts 2026-11-16 and results are due by 2026-11-18, so the
deployment has to stay up at least until the 18th (Nov 25 is the safer target, per S11.1).

What the vendors' own pages say, as of 2026-11-08. 🔍 marks anything I could not confirm on an
official page.

| Fact                                                                                                                                                | Source                       | Effect on Settle                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "spins down a Free web service that goes 15 minutes without receiving any inbound traffic"                                                          | [Render — Free plan][r-free] | a judge's first click after a quiet spell hits a cold start                                                                                |
| Free plan **does not** support background workers                                                                                                   | [Render — Free plan][r-free] | rules the free plan out outright: `pnpm worker` has nowhere to run                                                                         |
| "750 Free instance hours to each workspace per calendar month"                                                                                      | [Render — Free plan][r-free] | two always-on processes burn 750 h in ~15 days of a 30-day month                                                                           |
| "Free Render Postgres databases expire 30 days after creation"                                                                                      | [Render — Free plan][r-free] | survivable for the judging window, but the invoice rows go with it                                                                         |
| Hobby $0 / Pro $25 / Scale $499 per month; web services from $7; Postgres from $6                                                                   | [Render — Pricing][r-price]  | a paid tier is what buys the worker. 🔍 whether a $7 starter web service needs the $25 plan on top is not stated on the page               |
| Free $0 with $1 credit / Hobby $5 with $5 / Pro $20 with $20; "Railway charges per-second for the CPU, memory, and disk your services actually use" | [Railway — Pricing][rw]      | usage-based fits a worker, but a worker never idles: ~730 h/month of accrual against a small credit. 🔍 Postgres-plugin rate not confirmed |

[r-free]: https://render.com/docs/free
[r-price]: https://render.com/pricing
[rw]: https://railway.com/pricing

Fly.io was checked and dropped from the table: I could not get a readable plan/price statement from
its pages, and a number I cannot cite is a number I will not publish.

**The conclusion for S8.1.** Every free tier fails on one of the two hard requirements — no worker,
or a web service that sleeps — so hosting Settle is a paid decision, however small. The cheapest
credible shape is one small web service, one small worker service and one managed Postgres on the
same host, so the two processes can reach the database over a private network. A zero-spend
alternative exists and is already covered by §1: one small machine running both processes under a
supervisor, with Postgres on the same box. That trades a managed database for a `pg_dump` habit.

No account was created and nothing was deployed while writing this. Both are 👤.

## 7. What is still the human's, in order

1. **S8.1** — pick a host that runs a web service _and_ a worker service, plus managed Postgres; §6
   is the shortlist and the two facts that disqualify a free tier.
2. **S8.2** — set the variables in §5. Generate `SESSION_SECRET` yourself; it is a secret and must
   not pass through chat or a commit.
3. **S8.3** — deploy, then confirm from the outside: `curl -sS https://<host>/api/health` should
   answer `200 {"status":"ok","demo":false,"database":"ok"}`.
4. **S8.4** — one small real payment end-to-end, with the tx links recorded. Needs funded accounts
   and an explicit yes; nothing signs or sends without it (AGENTS.md §7).
