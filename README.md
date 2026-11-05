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

## Our other project
The same team also built **[Stack](https://github.com/MFrancis-dev/stack)** (track 01, Unstoppable DeFi): an independent project with its own repository, codebase and submission (NEAR HACKATHON rule Q-015).

## License
MIT
