# Settle

> Send an invoice. Get paid in dollars, from any token on any chain.
> NEAR HACKATHON · track 08 Real-World Money (`realworld`)

**Status:** core logic, integrations, every API route, the whole UI, the background worker, demo mode and the edge-case hardening are built and tested (`ROADMAP.md` has the per-phase numbers), and the web app is deployed. What is not done yet: one real payment end-to-end (it needs the vendor JWT), and the submission itself.

**Live demo URL:** https://settle-wine-alpha.vercel.app — the app in **real mode** against a hosted Postgres. It serves the landing page, a real NEAR-wallet sign-in, and invoice create / list / dashboard / receipt. Two honest limits on that URL: a client cannot complete a live payment quote there yet, because the vendor `ONECLICK_JWT` (S0.8) is not in hand so quotes stay fail-closed; and the background worker is not running, because a serverless host cannot keep a long-lived process. For the full offline walkthrough — the same code, no secrets, no network — run `pnpm demo` below; it is also what the README tells a screener to run.

## The problem

A freelancer finishes work for a client abroad. The invoice says **1,800 USDC**. The client holds wNEAR, or USDT on Solana, or ETH on Arbitrum — and now an ordinary invoice has become a crypto problem: which bridge, which gas token, which address format, and who is holding the money while it crosses. In practice the freelancer either eats a swap nobody priced, or asks the client to do something the client cannot do, and the invoice goes unpaid for a week.

The second half of the problem is trust. Every workaround that "handles it for you" does so by taking custody: the client's deposit lands on _somebody's_ address first, and the freelancer becomes an unsecured creditor of a service they have never heard of.

## What Settle is

Invoicing software with a cross-chain payment rail underneath it. The freelancer writes an ordinary line-item invoice in dollars and gets an ordinary pay link. The client opens that link, picks a token they actually hold on a chain they are actually on, and sends it. NEAR Intents solvers do the swap and deliver **the exact invoice amount** in the freelancer's stablecoin to **the freelancer's own address**. Settle records what happened and prints a receipt.

One Next.js app plus one worker script. No smart contract in the MVP, no custody, no relayer — receiving needs no gas.

## How NEAR Intents is used, concretely

Not "we use NEAR" as a badge. Here is the exact path a payment takes and where NEAR does the work:

1. **The intent is quoted, not hand-built.** `POST /v0/quote` on 1Click (the NEAR Intents swap API) with `swapType: EXACT_OUTPUT`, `destinationAsset` = the freelancer's payout asset, `amount` = the invoice total in that asset's base units, `recipient` = **the freelancer's own address**, `refundTo` = the client's own address, `depositType: ORIGIN_CHAIN`, `slippageTolerance: 100` (1%) and a deadline per origin chain. `EXACT_OUTPUT` is the point: the intent states what must _arrive_, so a moving market cannot turn a 1,800 USDC invoice into a 1,794 USDC one.
2. **The quote is verified before anything is shown.** `verifyQuoteSignature()` from `@defuse-protocol/one-click-sdk-typescript` runs over the stored quote before `depositAddress` is returned, stored or rendered. An address Settle cannot prove the manager signed is an address Settle will not hand a client.
3. **The client deposits to the intent, not to Settle.** The deposit address on the pay page belongs to the NEAR Intents flow. Settle never sees the funds and holds no key that could move them.
4. **Solvers settle it.** NEAR Intents resolvers fill the intent across chains and deliver the exact output amount to the freelancer's destination. A deposit **above** `amountIn` is refunded to the client's `refundTo` after the swap; a deposit **below** `minAmountIn` is refunded by the deadline (read from SDK 0.1.26's own docs, still 🔍 unconfirmed by the vendor).
5. **Settle reads the truth from the only source that has it.** `/v0/status` — polled by the worker every 5 s and by the pay page — is the sole origin of a status. A client cannot tell Settle it paid. The seven-value enum is asserted equal to the installed SDK's own enum by a test, and a status outside it is rejected as `malformed_response` rather than guessed at.
6. **NEAR is also the identity layer.** Sign-in is a NEP-413 message signed in a NEAR wallet — the app holds no key and no password. Changing a payout address needs a _fresh_ signature over the exact address and chain, so a hijacked session cannot quietly redirect money. What both signatures cover is chosen by the server: the wallet signs a challenge nonce minted by `GET /api/auth/challenge` and spent on first use, so a captured body can be replayed at most once and is worthless after its five-minute window. And where a payout account is not registered for USDC on NEAR, Settle checks it over RPC so delivery cannot fail on a registration technicality (the app-funded `storage_deposit` spend is S2.10 and needs an explicit approval, because it signs a real transaction).

Money never touches Settle. Settle stores invoices, quotes and statuses — that is the whole of its custody story.

## Try it

```bash
pnpm install
pnpm demo     # seeds a story, then starts the app on http://localhost:3000
```

Open **http://localhost:3000/demo**. No `.env`, no keys, no wallet, no external database, no network: with `DATABASE_URL` unset the app runs on PGlite in `./.pglite`, and with `DEMO_MODE` set the 1Click calls are answered from a recording instead of a partner service. Every screen says "Demo mode — nothing on this page moves money".

| If you want to see…                           | Do this                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| the whole story at once                       | `/demo` — one freelancer, ten invoices, one per status the app can reach                                                     |
| **a payment complete, with nobody watching**  | `/demo` → any _Awaiting payment_ invoice → "The client sent it" three times → open the receipt                               |
| a short payment, with the numbers             | the same invoice → "It arrived short" → the pay page states what arrived and what is still owed                              |
| a refund, and the reason recorded             | "Send it back" — the invoice goes back to _Awaiting payment_                                                                 |
| what a client sees, with no account           | the invoice's own pay link, printed on `/demo`                                                                               |
| why some networks are missing from the picker | the footnote under the token list — every excluded network is named, with its reason                                         |
| the exact figures recorded at settlement      | the receipt link, `/receipt/<token>?attempt=<id>` — or a bare `/receipt/<token>`, which the unique token resolves on its own |
| how a payout change is authorised             | `/settings` — typed twice, plus a fresh wallet signature (real mode)                                                         |
| what a payout change does _not_ do            | `/settings` → save a new address while a quote is open → the banner counts the payments still pointed at the old one         |
| the rules a change has to satisfy             | `ARCHITECTURE_ESSENTIALS.md`, then `ARCHITECTURE.md`                                                                         |

Restart the story with the button on `/demo`, or from a shell with `pnpm demo:seed --fresh`. Without `--fresh` a story that is already there is left alone, so restarting mid-talk keeps the payments you have already walked.

**Demo mode is the same code, not a copy of it.** It substitutes the _transport_: the recording answers `/v0/tokens` and `/v0/quote`, so every schema, every quote signature check and every status transition runs unchanged, and "simulate payment" writes through the same two functions the worker and the status poll use. `/demo` is refused for a real account and the real routes are refused for a demo one — `DEMO_MODE` cannot start next to a `DATABASE_URL` or a public `https://` origin at all.

Three things demo mode deliberately cannot show, so nothing here surprises you:

- **the CSV export.** `GET /api/export.csv` answers 403 for a demo account, because seeded rows must not leave the app looking like a real ledger.
- **native ETH.** The recorded token list has USDC on Ethereum and on Arbitrum but no native ETH, and there is no upstream in demo mode to read a live list from, so the browser journey pays in wNEAR.
- **a live wallet sign-in.** The demo cookie opens the dashboard so you can read it; signing in for real needs a NEAR wallet, and the app never holds a key.

### Running it for real

```bash
cp .env.example .env    # ONECLICK_JWT, PUBLIC_APP_URL, SESSION_SECRET, DATABASE_URL…
pnpm check-env          # reports missing names only, never values; exits 1 if it would not run
pnpm dev
```

Without `ONECLICK_JWT` the token list still loads and the pay page says plainly what it could not do, rather than inventing a quote.

### The worker

```bash
pnpm worker    # pollPayments every 5 s · expireQuotes every 60 s
```

A payment completes with nobody watching: the worker asks 1Click about every attempt that can still move and writes the answer forward-only, and it expires a quote whose deadline passed **with no deposit** — after one last read, because a deposit that lands in the final seconds is recorded, never expired. This is the _same_ write the pay page's status poll makes (`lib/server/sync.ts`), so the two cannot disagree about what a status means. `Ctrl-C` finishes the tick in flight before the process exits. `pnpm demo` does not start it (in demo mode the status answers are a mirror of the database, so polling would only re-read what the simulate button wrote); `pnpm worker` runs the real loops against the demo data whenever you want to watch them.

### The edges

The cases where a payment goes wrong are written down, not left to a generic error:

- **short payment** — the pay page states what arrived, what is still owed and what the invoice settles as, in numbers, so "send the difference" is actionable.
- **paid twice** — both attempts are reported; the newest is shown in full and the earlier one is still counted, and neither one's addresses are handed to the other payer.
- **the token the invoice already pays out in** — refused with `same_asset` _before_ a quote is asked for. The refusal deliberately does not print the seller's payout address: a pay link is public, and handing the destination to anyone holding one is the loss the app exists to prevent.
- **a chain whose refund needs a memo** — refused with the reason stated (a refund sent without it is not recoverable), and the token picker lists every excluded network under it with the reason.
- **below the exchange minimum** — the minimum is rendered in the token the client picked, not a bare "too low".
- **rate limits** — quotes 6/min, status polls 60/min and the signed-in writes 10/min, all in-process token buckets, all answering `429` with `Retry-After`.

### The tests

```bash
pnpm test     # 656 unit + route + component tests (plus 1 skipped), offline, against PGlite in memory
pnpm e2e      # 4 Playwright tests that build the app (`pnpm demo:prod`) and drive it in a real browser
```

Both run in CI, alongside a gitleaks job over the whole tree. The E2E journey is the one that proves the demo works the way it is documented to: no `.env`, no network, a fresh database, and a browser that clicks the buttons.

Route tests call the exported handlers directly against PGlite and a scripted 1Click, so they exercise the deployed code path rather than a mock of it. Nothing Settle wrote is mocked: substitution happens only outside the boundary (no network, no hosted database).

## Architecture in one page

```
app/ (routes, pages)   worker/ (two interval loops)
        │
   lib/server/    env, deps (composition root), http, session, auth, rateLimit,
        │         pay, invoices, payout, receipts, views, sync (the one write path)
   lib/db/   lib/oneclick/   lib/near/
        │
   lib/core/      pure: money, status, invoice math, address validators, ids
```

- **One direction of dependency.** `app/` and `worker/` call `lib/server`; `lib/server` calls `lib/db`, `lib/oneclick` and `lib/near`; all of them call `lib/core`, which calls nothing. `lib/api`, `lib/ui` and `lib/wallet` are the browser's half and import `lib/core` only, so a client component cannot pull the database or a secret into the bundle. The wallet library (`@near-wallet-selector/*`) is imported lazily by the shared provider rather than at module scope, so a page that only links to sign-in loads without it — landing First Load JS 414 kB → 150 kB, `/settings` 419 kB → 146 kB in the production build (#110).
- **Statuses move forward or not at all.** `canTransition` is a forward-only table with `success`, `refunded`, `failed` and `expired` absorbing, and an invoice is always re-derived from _every_ attempt it has. An invoice never un-pays.
- **One write path.** The worker, the status poll and `submit-tx` all write through `lib/server/sync.ts`, so three callers cannot disagree about what a status means.
- **Every boundary is validated.** zod on request bodies, on `process.env` and on every 1Click response; `server-only` markers keep server modules out of the client bundle.
- **Two runtimes, one secret.** `middleware.ts` runs on Edge and route handlers on Node, so per-process module state is _two_ values — the reason demo mode pins a fixed session secret and real mode requires `SESSION_SECRET`.
- Full detail in `ARCHITECTURE.md` (short version: `ARCHITECTURE_ESSENTIALS.md`); file layout in `project_structure.md`; remaining work in `ROADMAP.md`; what a host has to provide in `DEPLOY.md`; launch drafts (video script, X post, and the submission payload — a field skeleton plus a placeholder worked example, neither of them the real thing) in `LAUNCH.md`.

**No custody.** Settle holds no client funds, no key that can move a client's deposit, and no payout key. The quote's `recipient` is the freelancer's own address and refunds go to the client's own address. The one key the app _can_ hold — `STORAGE_PAYER_PRIVATE_KEY`, which would pay USDC storage deposits on NEAR so delivery cannot fail on a registration technicality — is optional, app-funded, spends storage fees rather than anybody's payment, and is not wired to sign in the shipped MVP (S2.10 needs an explicit approval).

## Limitations, honestly

- **Web app deployed; the worker is not.** The Next.js app is live on Vercel (https://settle-wine-alpha.vercel.app) in **real mode** against a hosted Postgres — landing, NEAR-wallet sign-in, invoice create / list / dashboard / receipt — and `GET /api/health` returns `{"status":"ok","demo":false,"database":"ok"}` from the running deployment, not only from a local boot. Two things that URL does not do yet, stated plainly: **no live payment quote**, because the vendor `ONECLICK_JWT` (S0.8) is not in hand, so the pay page fails closed before it prices anything; and **no background worker**, because a serverless host cannot keep the long-lived 5 s poll / 60 s expire process. That second limit is exactly why `DEPLOY.md` §6 concluded that a two-process host is a paid decision — Render's free-plan page says free plans do not support background workers, and usage-based hosts bill a worker that never idles. A full live payment therefore still needs a host that runs both processes plus the JWT. The offline evidence is unchanged: `pnpm demo`, the E2E browser journey — which drives a **production build** (`pnpm build` + `pnpm start`, the same two commands a host runs) rather than `next dev` — and 641 offline tests. `DEPLOY.md` also records two constraints that were measured, not assumed: PGlite is single-process — two processes on one directory lost half their writes and killed one outright — so a hosted Settle needs Postgres; and demo mode deliberately refuses an `https://` URL, so the hosted app runs **real mode** (decision `SD-8`) and the demo story lives in `pnpm demo` and the video.
- **No test drives 1Click's real minimum.** The 400-with-`try at least N` shape is coded and tested against fixtures; provoking it live needs the partner JWT (S0.8, #11).
- **The memo-chain list is ours.** 1Click does not publish which origins carry a memo requirement, so `MEMO_CHAIN_CODES` is flagged 🔍 unverified in `lib/core/address.ts`. Refusing those chains errs safe: an address Settle cannot check is not one it will send money back to.
- **A region block is passed through, not recognised.** The vendor's own wording reaches the client; Settle does not match it against strings it guessed.
- **Rate limits are in-process.** Correct for one instance; N instances would each keep their own bucket. Stated in `ARCHITECTURE.md` §3.1 rather than hidden.
- **🔍 items were coded from official documentation and are still unconfirmed by the vendor** — deadline windows, storage-registration behaviour, the memo requirement, overpayment refunds. They are listed in `ARCHITECTURE_ESSENTIALS.md`, not buried.

## Libraries added during the build (rule Q-005)

Everything else came with the scaffold in `package.json`; these were chosen while coding, pinned to exact versions.

| Library                                                                                     | Why we added it                                                                                                                                                                                             | Task       |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `@noble/hashes`                                                                             | keccak256 for the EIP-55 checksum on EVM payout addresses                                                                                                                                                   | S1.4       |
| `bs58`                                                                                      | base58 decode for Solana payout addresses (must be 32 bytes)                                                                                                                                                | S1.4       |
| `@noble/curves`                                                                             | ed25519 verify for NEP-413 sign-in, and ed25519 sign for the quote fixtures                                                                                                                                 | S2.4, S2.5 |
| `@near-wallet-selector/core`                                                                | the wallet contract itself: our NEP-413 serialiser is checked against its `serializeNep413` and `verifySignature` byte for byte, so the signed-bytes rule is the library's, not our reading of the standard | S0.14      |
| `@near-wallet-selector/modal-ui` · `my-near-wallet` · `hot-wallet`                          | sign-in for Phase 4, installed and pinned now so the shape it signs is fixed by a version rather than by memory                                                                                             | S0.14      |
| `buffer`                                                                                    | wallet-selector's NEP-413 serialiser wants a Node `Buffer`, which a browser does not have; polyfilled once in `lib/wallet/buffer-global.ts`                                                                 | S4.1       |
| `qrcode.react`                                                                              | the deposit address as a QR, so a client can pay from a phone without copying anything                                                                                                                      | S4.4       |
| `jsdom` · `@testing-library/react` · `@testing-library/dom` · `@testing-library/user-event` | component tests: the screens where a wrong word or a wrong number is a money bug (dev-only)                                                                                                                 | S4.8       |

`@near-wallet-selector/react-hook` was installed for the same reason and then dropped: its provider calls `setupWalletSelector()` inside render, so Settle owns the selector singleton itself (`lib/wallet/selector.ts`).

MetaMask is deliberately **not** among them: the `ethereum-wallets` module throws on `signMessage`, so it cannot answer NEP-413 (`ARCHITECTURE.md` §11). `near-api-js` is not a dependency either — wallet-selector v10 says to drop it, v7 moved `keyStores` out and asks for a newer Node than our `engines` floor, and Settle already has its own RPC client.

Sign-in posts the fields the wallet actually signed — `{message, recipient, nonce, signature, publicKey, accountId}` — and the server rebuilds the Borsh payload from them before verifying, so it accepts the published NEP-413 shape and nothing else (`ARCHITECTURE.md` §11). The `nonce` is not the wallet's own: the client fetches it from `GET /api/auth/challenge` and signs the one Settle minted, and the server spends it — a signed body captured off the wire can then be used at most once, and is refused outright after its five-minute window.

**Templates and generated code.** No app template: the scaffold is `create-next-app` output plus our own files, and the UI is hand-rolled on Tailwind role tokens in `components/ui/*` — no component library, because the parts that carry money are eight small files and a library would put its own words, rounding and focus styles between us and the spec. `drizzle/` migrations are generated by `drizzle-kit` and never hand-edited. The 1Click SDK supplies the API types, `quoteHash()` and `verifyQuoteSignature()`; the HTTP transport, the zod schemas and every status rule are ours.

**Visual identity.** The screens follow one deliberate system rather than a framework default: an achromatic ledger palette where the chrome (borders, buttons, nav) carries no colour and a single brand green is reserved for the one number that matters — money that has actually arrived. Type is Geist (Geist Mono for amounts and addresses, weight 700 for money only), surfaces are flat with a 1px rule instead of shadows, labels are sentence case, and the dashboard sits in an open-plane sidebar shell that folds to a top bar on a phone. The mark (an arrow descending onto a rule) is `components/ui/mark.tsx`. Tokens live in `app/globals.css` as Tailwind `@theme` roles, so every screen references the role, never a raw colour.

The landing page is designed as a page in that same system: the mark is the one motif, running from the header through the hero's receipt to a large construction in the footer, and the page's pictures are the product's own screens — the receipt, a working token picker (pick a token, watch the deposit amount follow), the pay page and the deposit panel with a live QR.

**Written during the hackathon window.** All of this code was written between 2026-11-03 and the submission deadline (2026-11-14 23:59 UTC), in this repository's public commit history, phase by phase against the tasks in `ROADMAP.md`. No pre-existing project was renamed or re-submitted. The team's other entry, **Stack**, is a separate repository with its own history (rule Q-015).

## Our other project

The same team also built **[Stack](https://github.com/MFrancis-dev/stack)** (track 01, Unstoppable DeFi): an independent project with its own repository, codebase and submission (NEAR HACKATHON rule Q-015).

## License

MIT
