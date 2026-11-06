# Settle

> Send an invoice. Get paid in dollars, from any token on any chain.
> NEAR HACKATHON · track 08 Real-World Money (`realworld`)

**Status:** scaffold. See `ROADMAP.md` for progress. The full README is task S9.1–S9.4.

## Try it (once built)
```bash
pnpm install
pnpm demo
```

## Libraries added during the build (rule Q-005)
Everything else came with the scaffold in `package.json`; these were chosen while coding, pinned to exact versions.

| Library | Why we added it | Task |
|---|---|---|
| `@noble/hashes` | keccak256 for the EIP-55 checksum on EVM payout addresses | S1.4 |
| `bs58` | base58 decode for Solana payout addresses (must be 32 bytes) | S1.4 |
| `@noble/curves` | ed25519 verify for NEP-413 sign-in, and ed25519 sign for the quote fixtures | S2.4, S2.5 |
| `@near-wallet-selector/core` | the wallet contract itself: our NEP-413 serialiser is checked against its `serializeNep413` and `verifySignature` byte for byte, so the signed-bytes rule is the library's, not our reading of the standard | S0.14 |
| `@near-wallet-selector/modal-ui` · `my-near-wallet` · `hot-wallet` | sign-in for Phase 4, installed and pinned now so the shape it signs is fixed by a version rather than by memory | S0.14 |

`@near-wallet-selector/react-hook` was installed for the same reason and then dropped: its provider calls `setupWalletSelector()` inside render, so Settle owns the selector singleton itself (`lib/wallet/selector.ts`).

MetaMask is deliberately **not** among them: the `ethereum-wallets` module throws on `signMessage`, so it cannot answer NEP-413 (`ARCHITECTURE.md` §11). `near-api-js` is not a dependency either — wallet-selector v10 says to drop it, v7 moved `keyStores` out and asks for a newer Node than our `engines` floor, and Settle already has its own RPC client.

Sign-in posts the fields the wallet actually signed — `{message, recipient, nonce, signature, publicKey, accountId}` — and the server rebuilds the Borsh payload from them before verifying, so it accepts the published NEP-413 shape and nothing else (`ARCHITECTURE.md` §11).

## Our other project
The same team also built **[Stack](https://github.com/MFrancis-dev/stack)** (track 01, Unstoppable DeFi): an independent project with its own repository, codebase and submission (NEAR HACKATHON rule Q-015).

## License
MIT
