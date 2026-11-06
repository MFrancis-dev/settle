# Settle

> Send an invoice. Get paid in dollars, from any token on any chain.
> NEAR HACKATHON · track 08 Real-World Money (`realworld`)

**Status:** core logic, integrations, every API route, the whole UI and the background worker are built and tested (`ROADMAP.md` has the per-phase numbers). What is not built yet: demo data (Phase 6) — so the screens render, but there is nothing seeded to look at. The full README, written for a judge and for an AI screener, is task S9.1–S9.4.

## Try it
```bash
pnpm install
pnpm demo     # seeds the embedded database, then starts the app on http://localhost:3000
```
No `.env`, no keys, no external database: with `DATABASE_URL` unset the app runs on PGlite in `./.pglite`. Signing in needs a NEAR wallet (the app never holds a key), and quotes need the 1Click partner JWT — without it the token list still loads and the pay page says plainly what it could not do.

| If you want to see… | Go to |
|---|---|
| what a client sees, with no account | `/pay/<publicId>` from an invoice's "Copy link" |
| the exact figures recorded at settlement | `/receipt/<token>` from a paid attempt |
| how a payout change is authorised | `/settings` (typed twice + a fresh wallet signature) |
| the rules a change has to satisfy | `ARCHITECTURE_ESSENTIALS.md`, then `ARCHITECTURE.md` |

### The worker
```bash
pnpm worker    # pollPayments every 5 s · expireQuotes every 60 s
```
A payment completes with nobody watching: the worker asks 1Click about every attempt that can still move and writes the answer forward-only, and it expires a quote whose deadline passed **with no deposit** — after one last read, because a deposit that lands in the final seconds is recorded, never expired. This is the *same* write the pay page's status poll makes (`lib/server/sync.ts`), so the two cannot disagree about what a status means. `Ctrl-C` finishes the tick in flight before the process exits.

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
