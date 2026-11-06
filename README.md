# Settle

> Send an invoice. Get paid in dollars, from any token on any chain.
> NEAR HACKATHON · track 08 Real-World Money (`realworld`)

**Status:** core logic, integrations, every API route, the whole UI, the background worker, demo mode and the edge-case hardening are built and tested (`ROADMAP.md` has the per-phase numbers). What is not done yet: hosting, one real payment end-to-end, and the submission itself. The full README, written for a judge and for an AI screener, is task S9.1–S9.4.

## Try it
```bash
pnpm install
pnpm demo     # seeds a story, then starts the app on http://localhost:3000
```
Open **http://localhost:3000/demo**. No `.env`, no keys, no wallet, no external database, no network: with `DATABASE_URL` unset the app runs on PGlite in `./.pglite`, and with `DEMO_MODE` set the 1Click calls are answered from a recording instead of a partner service. Every screen says "Demo mode — nothing on this page moves money".

| If you want to see… | Do this |
|---|---|
| the whole story at once | `/demo` — one freelancer, ten invoices, one per status the app can reach |
| **a payment complete, with nobody watching** | `/demo` → any *Awaiting payment* invoice → "The client sent it" three times → open the receipt |
| a short payment and a refund | the same invoice → "It arrived short", or "Send it back" (the invoice goes back to *Awaiting payment*) |
| what a client sees, with no account | the invoice's own pay link, printed on `/demo` |
| the exact figures recorded at settlement | the receipt link, or `/receipt/<token>?attempt=<id>` |
| how a payout change is authorised | `/settings` — typed twice, plus a fresh wallet signature (real mode) |
| the rules a change has to satisfy | `ARCHITECTURE_ESSENTIALS.md`, then `ARCHITECTURE.md` |

Restart the story with the button on `/demo`, or from a shell with `pnpm demo:seed --fresh`. Without `--fresh` a story that is already there is left alone, so restarting mid-talk keeps the payments you have already walked.

**Demo mode is the same code, not a copy of it.** It substitutes the *transport*: the recording answers `/v0/tokens` and `/v0/quote`, so every schema, every quote signature check and every status transition runs unchanged, and "simulate payment" writes through the same two functions the worker and the status poll use. `/demo` is refused for a real account and the real routes are refused for a demo one — `DEMO_MODE` cannot start next to a `DATABASE_URL` or a public `https://` origin at all.

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
A payment completes with nobody watching: the worker asks 1Click about every attempt that can still move and writes the answer forward-only, and it expires a quote whose deadline passed **with no deposit** — after one last read, because a deposit that lands in the final seconds is recorded, never expired. This is the *same* write the pay page's status poll makes (`lib/server/sync.ts`), so the two cannot disagree about what a status means. `Ctrl-C` finishes the tick in flight before the process exits. `pnpm demo` does not start it (in demo mode the status answers are a mirror of the database, so polling would only re-read what the simulate button wrote); `pnpm worker` runs the real loops against the demo data whenever you want to watch them.

### The edges
The cases where a payment goes wrong are written down, not left to a generic error:
- **short payment** — the pay page states what arrived, what is still owed and what the invoice settles as, in numbers, so "send the difference" is actionable.
- **paid twice** — both attempts are reported; the newest is shown in full and the earlier one is still counted, and neither one's addresses are handed to the other payer.
- **the token the invoice already pays out in** — refused with `same_asset` *before* a quote is asked for. The refusal deliberately does not print the seller's payout address: a pay link is public, and handing the destination to anyone holding one is the loss the app exists to prevent.
- **a chain whose refund needs a memo** — refused with the reason stated (a refund sent without it is not recoverable), and the token picker lists every excluded network under it with the reason.
- **below the exchange minimum** — the minimum is rendered in the token the client picked, not a bare "too low".
- **rate limits** — quotes 6/min, status polls 60/min and the signed-in writes 10/min, all in-process token buckets, all answering `429` with `Retry-After`.

### The tests
```bash
pnpm test     # 630 unit + route + component tests (plus 1 skipped), offline, against PGlite in memory
pnpm e2e      # 4 Playwright tests that start `pnpm demo` themselves and drive a real browser
```
Both run in CI. The E2E journey is the one that proves the demo works the way it is documented to: no `.env`, no network, a fresh database, and a browser that clicks the buttons.

## Libraries added during the build (rule Q-005)
Everything else came with the scaffold in `package.json`; these were chosen while coding, pinned to exact versions.

| Library | Why we added it | Task |
|---|---|---|
| `@noble/hashes` | keccak256 for the EIP-55 checksum on EVM payout addresses | S1.4 |
| `bs58` | base58 decode for Solana payout addresses (must be 32 bytes) | S1.4 |
| `@noble/curves` | ed25519 verify for NEP-413 sign-in, and ed25519 sign for the quote fixtures | S2.4, S2.5 |
| `@near-wallet-selector/core` | the wallet contract itself: our NEP-413 serialiser is checked against its `serializeNep413` and `verifySignature` byte for byte, so the signed-bytes rule is the library's, not our reading of the standard | S0.14 |
| `@near-wallet-selector/modal-ui` · `my-near-wallet` · `hot-wallet` | sign-in for Phase 4, installed and pinned now so the shape it signs is fixed by a version rather than by memory | S0.14 |
| `buffer` | wallet-selector's NEP-413 serialiser wants a Node `Buffer`, which a browser does not have; polyfilled once in `lib/wallet/buffer-global.ts` | S4.1 |
| `qrcode.react` | the deposit address as a QR, so a client can pay from a phone without copying anything | S4.4 |
| `jsdom` · `@testing-library/react` · `@testing-library/dom` · `@testing-library/user-event` | component tests: the screens where a wrong word or a wrong number is a money bug (dev-only) | S4.8 |

`@near-wallet-selector/react-hook` was installed for the same reason and then dropped: its provider calls `setupWalletSelector()` inside render, so Settle owns the selector singleton itself (`lib/wallet/selector.ts`).

MetaMask is deliberately **not** among them: the `ethereum-wallets` module throws on `signMessage`, so it cannot answer NEP-413 (`ARCHITECTURE.md` §11). `near-api-js` is not a dependency either — wallet-selector v10 says to drop it, v7 moved `keyStores` out and asks for a newer Node than our `engines` floor, and Settle already has its own RPC client.

Sign-in posts the fields the wallet actually signed — `{message, recipient, nonce, signature, publicKey, accountId}` — and the server rebuilds the Borsh payload from them before verifying, so it accepts the published NEP-413 shape and nothing else (`ARCHITECTURE.md` §11).

## Our other project
The same team also built **[Stack](https://github.com/MFrancis-dev/stack)** (track 01, Unstoppable DeFi): an independent project with its own repository, codebase and submission (NEAR HACKATHON rule Q-015).

## License
MIT
