# PRD — Settle

> Working name. **"Send an invoice. Get paid in dollars, from any token on any chain."**
> NEAR HACKATHON · Track **08 Real-World Money** (`realworld`) · Deadline 2026-11-14 23:59 UTC
> Sister project (separate repo, separate submission): **Stack** — track 01 (`defi`). See §13.
> Every contribution updates `ROADMAP.md` (see `AGENTS.md`).

---

## 1. What we are building

Settle is invoicing for freelancers and small businesses whose clients are in other countries.

1. The freelancer signs in with a NEAR wallet and sets **where they want to be paid**: USDC to their NEAR account (default), or a stablecoin on another chain at an address they choose (e.g. the deposit address of the exchange they use to cash out locally).
2. They create an invoice in USD and share a link.
3. The client opens the link, picks **whatever token and chain they already hold**, and sees exactly how much to send.
4. NEAR Intents (1Click API) converts it and delivers the **exact invoiced amount** straight to the freelancer's payout destination. Settle never holds the money.
5. Both sides get a receipt; the freelancer gets a CSV their accountant can open without questions.

One sentence for judges: **"Client pays in anything → freelancer gets exactly the invoiced dollars where they need them → no gas, no bridges, no custody."**

---

## 2. The problem

- Freelancers in Nigeria, Kenya, Ghana, the Philippines, Pakistan and Latin America wait days or weeks for international payments, lose a large share to fees and currency conversion, and have accounts frozen without warning.
- Remittance-style transfers cost about 6% on average (World Bank) and take days.
- Clients hold different tokens on different chains; "please send USDC on chain X" loses deals and causes wrong-chain mistakes.
- Crypto payment tools assume the recipient understands gas, tokens, bridges and wallets.
- Money that arrives somewhere the freelancer can't spend it is useless; they need it where they cash out.
- Accountants can't read crypto records.

---

## 3. Who it's for

| Persona | Description | Need |
|---|---|---|
| **Ada, freelance designer (Lagos)** | Clients in the US and EU. Has a NEAR wallet and an account at a local exchange. | Get paid fast, in dollars, delivered where she cashes out. |
| **Client (Berlin agency)** | Holds ETH on Arbitrum and USDC on Base. | Pay an invoice in a minute from the wallet they already use. |
| **Small studio (Manila, 4 people)** | Bills several clients a month. | Clear status per invoice and clean records. |
| **Accountant** | Reviews the books monthly. | One CSV: dates, amounts, rates, fees, links. |

Not for (v1): payroll to many payees, merchants at a checkout counter, bank cash-out.

---

## 4. Goals and non-goals

### Goals
- G1. A client pays from any token/chain supported by 1Click; the freelancer receives the **exact** invoiced amount.
- G2. Funds go **directly** to the freelancer's payout destination. Settle never takes custody.
- G3. The freelancer never pays gas and never needs to hold NEAR to receive payments.
- G4. Every invoice is traceable: quote → deposit → delivery, with links.
- G5. The client always knows what to do and what happened (including underpaid / refunded).
- G6. A judge can try the whole product in under 3 minutes with no funds (dry-run + demo mode).

### Non-goals
- Savings, investing or scheduled buys (that is **Stack**, a separate project).
- Fiat bank cash-out.
- Holding user funds in any Settle contract or account.
- Tax calculation.
- Invoices priced in currencies other than USD (v1).

---

## 5. User stories

**Freelancer**
- US-1. Sign in with my NEAR wallet, no transaction needed.
- US-2. Set my payout destination: USDC to my NEAR account, or a supported stablecoin on another chain at an address I paste. I see the chain name clearly and confirm the address twice.
- US-3. Create an invoice: client name, client email (optional), line items, due date, memo. Get a shareable link.
- US-4. See each invoice's live status.
- US-5. Get a receipt for each paid invoice with delivery transaction links.
- US-6. Export a CSV.
- US-7. Change my payout destination safely (re-sign, warnings, existing quotes unaffected).

**Client**
- US-8. Open the link, see who bills me and for what, choose my token and chain, see exactly how much to send and the fee.
- US-9. Send from my wallet to the address shown (QR + copy); the page updates by itself to Paid.
- US-10. If I send too little, too much, too late, or twice, the page tells me plainly what happened and where any refund went.
- US-11. Download a receipt.

**Judge**
- US-12. Open demo mode, preview a real live quote (dry-run), simulate a payment through every status, open the CSV.

---

## 6. Functional requirements

### 6.1 Account and payout destination
- FR-1. Sign in with NEAR wallet via NEP-413 signed message (no transaction).
- FR-2. Payout destination = (asset, chain, address). Default: USDC on NEAR to the signed-in account.
- FR-3. Supported payout assets: stablecoins listed by 1Click `/v0/tokens` (USDC/USDT on supported chains). The list is resolved at runtime.
- FR-4. Address validation per chain (format + checksum where the chain has one). Typed twice. Chain shown by name.
- FR-5. If the payout is USDC on NEAR and the account isn't storage-registered on the USDC contract, Settle registers it (app pays).
- FR-6. Changing the payout destination requires a fresh NEP-413 signature, shows a warning, and applies only to **new** quotes. Each payment attempt stores a snapshot of the destination it used.

### 6.2 Invoices
- FR-7. Create invoice: client name, client email (optional), line items (description, qty, unit price), due date, memo. Total in USD (= USDC/USDT 1:1 face value).
- FR-8. Public link `/pay/{publicId}` (unguessable). Shows freelancer display name, items, total, status. Nothing else private.
- FR-9. Statuses: `draft`, `open`, `payment_detected`, `processing`, `paid`, `underpaid`, `overpaid`, `refunded`, `failed`, `cancelled`, `paid_after_cancel`.
- FR-10. Cancel an unpaid invoice.

### 6.3 Paying
- FR-11. Opening the link creates **nothing**. The client picks origin token/chain and enters a refund address, then clicks "Get payment address".
- FR-12. Quote: `EXACT_OUTPUT`, destination = freelancer's payout asset/address, amount = invoice total, refund to client's address.
- FR-13. Verify the quote signature before showing the deposit address.
- FR-14. Show amount to send, fee, deposit address (copy + QR), expiry countdown, estimated time; a clear warning that exchange withdrawal fees can make the payment arrive short.
- FR-15. Dry-run preview available before creating a real deposit address.
- FR-16. Only one active real quote per invoice. Switching token warns that the previous address stays live until its expiry.
- FR-17. Live status (polled), optional tx hash submit, one-click re-quote after expiry.

### 6.4 Records
- FR-18. Receipts (HTML, printable) for client and freelancer: invoice, amount, asset sent, asset delivered, timestamps, links.
- FR-19. Dashboard: totals (invoiced, paid, outstanding), recent activity, attention list (underpaid, overpaid, paid after cancel).
- FR-20. CSV: date (UTC), invoice no., client, line total, asset paid, amount paid, asset delivered, amount delivered, fee, status, links.

### 6.5 Demo and dry-run
- FR-21. Dry-run: real `dry: true` quotes, no deposit address.
- FR-22. Demo mode: fictional freelancer with invoices in every status; "simulate payment" walks one invoice through all statuses; works with **no secrets and no external database**.

---

## 7. Non-functional requirements

- **No custody**: Settle's servers and accounts never receive user funds.
- **Honesty**: never show a status not confirmed by 1Click.
- **Privacy**: client data stays off-chain and private to the freelancer.
- **Secrets** in env vars only.
- **Speed**: status change visible within ~10 s.
- **Mobile-first** pay page; no crypto jargon on client pages.

---

## 8. Success criteria (judging)

From the README, a judge can:
1. `pnpm demo` on a fresh clone → dashboard with invoices in every status.
2. Create an invoice → open the pay link → pick "ETH on Arbitrum" → see a real dry-run quote.
3. Simulate a payment → watch it reach Paid → open the receipt.
4. See an underpaid and an overpaid example and what the client is told.
5. Export the CSV and open it.
Plus a real payment shown in the demo video.

---

## 9. Scope

**MVP:** sign-in, payout destination, invoices, pay page with dry-run + real quotes, signature verification, statuses incl. edge cases, receipts, dashboard, CSV, demo mode, README.

**Stretch:** on-chain receipt registry on NEAR · EVM wallet connect on the pay page · recurring invoices · email notifications · invoices in EUR/GBP · PDF export · 1Click `appFees` for a business model.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Judges see "no NEAR contract" as weak NEAR integration | NEAR Intents is the settlement layer; NEAR wallet sign-in; USDC-on-NEAR default payout; on-chain receipt registry is the first stretch item. Say this plainly in the README. |
| Session hijack changes payout address → future payments stolen | Fresh NEP-413 signature for changes, warning banner, change log, snapshots per attempt. |
| Client pays from an exchange and arrives short | Prominent warning; underpaid flow explains refund or top-up. |
| Paid twice / overpaid | Statuses + data the freelancer needs to refund manually. |
| Quote expires on slow origin chains | Deadline per origin chain. |
| Two projects, ten days | Settle has no contract; keep MVP tight; ROADMAP is the cut line. |

---

## 11. Hard questions

**What would break?** Wrong payout address (permanent loss) · payout to a NEAR account not registered on USDC · exchange fees causing underpayment · double payment after switching tokens · AI screener can't run it without secrets · quote deadline on BTC origin · 1Click outage or no route.

**Edge cases:** payment after cancel · overpayment handling · client already holds the payout asset on the payout chain (same-asset quote may not exist — direct transfer instructions instead) · refund address on a memo chain · line-item rounding · client in a region 1Click doesn't serve (show error, don't retry) · freelancer changes payout destination while a quote is live.

**Overengineering to avoid:** a Settle contract in MVP · custody or escrow · our own relayer (no NEAR gas is needed to receive) · multi-package monorepo · queues.

Details and fixes: `ARCHITECTURE.md` §11.

---

## 12. Open questions
- Q1. Does 1Click storage-register NEAR recipients automatically? (affects FR-5)
- Q2. Exact `/v0/status` enum, top-up after `INCOMPLETE_DEPOSIT`, overpayment behaviour, late deposits.
- ~~Q3. Which payout stablecoins/chains to offer in the MVP list.~~ Decided (SD-4): USDC on NEAR, Base, Arbitrum, Solana, Ethereum; USDT on Ethereum, Solana.

---

## 13. Relationship to Stack (hackathon rule Q-015)

Settle and Stack are **independent projects** by the same team: separate repositories, separate codebases (no shared packages), separate demos and submissions. Each README names the other project. Settle never holds funds and has no savings features; Stack has no invoicing.

## 14. Hackathon deliverables
Public repo + README ("do X → see Y"), MIT LICENSE, libraries listed, README names Stack · demo post on X (@NEARProtocol, #NEARHackathon) · submission with track `realworld`.
