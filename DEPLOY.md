# Deploying Settle (Phase 8 preparation)

What a host has to provide, and the two constraints that decide the choice. **Nothing has been
deployed and no vendor manifest is committed**: picking the host is S8.1 and is 👤 the human's, and
an untested `render.yaml` or `Dockerfile` in the repo would read as a claim that it works.

Two findings below were measured on 2026-11-08 against the installed dependencies, not taken from
documentation. Both change what S8.1 can choose.

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

## 3. Measured: demo mode cannot be hosted behind TLS

`demoModeConflict()` (`lib/server/adapters.ts`) refuses to honour `DEMO_MODE` when
`PUBLIC_APP_URL` starts with `https://`, on the reasoning that a deployment which could take a real
payment must never simulate one. Nearly every host terminates TLS and hands back an `https://` URL.

So **S8.3 as written — "Deploy; hosted demo mode reachable" — is not achievable on a normal host.**
That is the guard working, not a bug. The honest choices:

- **(a) Host real mode.** No `DEMO_MODE`, `DATABASE_URL` set, `SESSION_SECRET` and
  `PUBLIC_APP_URL` set. The hosted app is then a real deployment: sign-in works, invoices are real
  rows, and quotes come from 1Click. `ONECLICK_JWT` is optional (rule Q-006: without it a 0.2% fee
  applies), and a real _payment_ still needs funded accounts, which is S8.4 and 👤.
  **This is the recommendation** — it is what a judge can actually click, and the demo-mode story is
  already covered by `pnpm demo` in the video (S10.2).
- **(b) Weaken the guard** so demo mode is allowed on `https://`. This removes a safety invariant
  that exists to stop a simulated payment being mistaken for a real one. Not recommended, and not
  something to do without an explicit decision.

Whichever is chosen, `ROADMAP.md` S8.3 should be reworded, because the current wording asks for
something the code deliberately refuses.

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

## 6. What is still the human's, in order

1. **S8.1** — pick a host that runs a web service _and_ a worker service, plus managed Postgres.
2. **S8.2** — set the variables in §5. Generate `SESSION_SECRET` yourself; it is a secret and must
   not pass through chat or a commit.
3. **S8.3** — deploy, then confirm from the outside: `curl -sS https://<host>/api/health` should
   answer `200 {"status":"ok","demo":false,"database":"ok"}`.
4. **S8.4** — one small real payment end-to-end, with the tx links recorded. Needs funded accounts
   and an explicit yes; nothing signs or sends without it (AGENTS.md §7).
