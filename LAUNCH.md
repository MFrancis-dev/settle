# Launch materials (Phase 10)

Drafts for the human to use. Nothing here is published, posted or submitted by the agent:
recording the video (S10.2), posting on X (S10.4) and sending the submission (S10.7) are
the human's actions and need an explicit yes in chat first.

The **real** submission payload is not in this repository — it carries personal data (lead name,
email, payout account), and the live rules say not to commit it. It is printed in chat, built field
by field from the human's answers, and sent once. §4 also carries a **placeholder** version of the
same eleven fields: every invented value is visibly fake, it contains no personal data, and its only
job is to show the exact shape and escaping a real POST body needs.

---

## 1. Rules re-read live on 2026-11-06 (S10.5, #85)

Read from https://nearhackathon.com/HACKATHON.md on 2026-11-06. What it changes for us:

| Fact                 | Value in the live file                                                                                                                                    | Effect on our plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development ends     | 2026-11-14T23:59:00Z                                                                                                                                      | unchanged; our target submit date of 2026-11-13 still leaves a day of margin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Judging starts       | 2026-11-16T00:00:00Z                                                                                                                                      | the hosted demo must be up before this, not merely before the deadline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Results announced by | 2026-11-18T23:59:00Z                                                                                                                                      | S11.1's "keep the demo up to at least Nov 18" is exactly right; Nov 25 remains the safer target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Code window          | from the 2026-10-19 announcement to 2026-11-14 (Q-001)                                                                                                    | our README says "written between 2026-11-03 and the deadline", which sits inside the window; no baseline commits exist to separate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1Click JWT           | **not required**; without it a 0.2% fee applies (Q-006)                                                                                                   | the app must keep working with no `ONECLICK_JWT`, which it does — the token list still loads and the pay page says what it could not do. Registering at https://partners.near-intents.org would remove the fee. S0.12/S0.13 were answered on 2026-11-09 with unauthenticated `dry` quotes. **2026-11-10 correction:** the vendor now refuses every unauthenticated quote — the same USDC→USDC dry call that returned 200 the day before returns `400 Internal server error`, a bogus bearer returns `401 Invalid token`, and `/v0/tokens` still answers — so the JWT is required for any quote, not just a non-dry one, and S8.4 is blocked on it |
| Testnet for Intents  | none exists or is planned (Q-007)                                                                                                                         | confirms the demo-recording design: mainnet, separate dev accounts, tiny amounts, `dry: true` quotes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Local-only demo      | allowed, **but** "screenshots are not enough when judges cannot open the demo" — a video is needed; a hosted demo is a plus (Q-012)                       | S10.2's video is mandatory in practice, not optional. This raises the priority of the recording above the hosting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AI screening         | Claude Code and Codex screen every project: reproducibility check, feature verification, structured report, preliminary score; humans decide (Q-017)      | the README's "do X → see Y" table and `pnpm demo` are written for exactly this reader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `website` field      | **a spam trap**: any non-empty value rejects the submission                                                                                               | our payload must not contain it. The contract is the eleven fields below and nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Request changes      | mistakes are fixed at https://nearhackathon.com/request-changes, never by re-submitting; the same repo answers 409                                        | one attempt per project, as AGENTS.md §7 already says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tracks               | `realworld` = "Real-World Money … payroll, invoicing, remittances, merchant payments and stablecoin rails … STABLECOINS, NEAR INTENTS, META TRANSACTIONS" | Settle is invoicing + stablecoin rails over NEAR Intents: `realworld` is the fit. `defi` and `business` are arguable but the hints there are trading/agent-treasury; one honest track beats three loose ones                                                                                                                                                                                                                                                                                                                                                                                                                                      |

No rule changed in a way that invalidates work already merged. The two live consequences are:
**the demo video is effectively required**, and **the payload must not gain a `website` field**.

---

## 2. Demo video script (S10.1, #81)

Target: 2–3 minutes, one take per shot, no architecture slides. The live rules say to show
_one complete moment_ — a real user action to a visible result — and to skip long intros.

| #   | Shot                               | Say / show                                                                                                                                                                                                                                                                                                                                                                  | Length |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Cold open, the pay page on a phone | "This is an invoice for 1,800 USDC. The person paying it doesn't have USDC." Show the token picker: wNEAR, USDT on Solana, ETH on Arbitrum.                                                                                                                                                                                                                                 | 15 s   |
| 2   | The problem in one sentence        | "Freelancers get paid late because paying them cross-chain is a bridge, a gas token and an address format nobody wants to get wrong. And every service that fixes it holds your money while it crosses."                                                                                                                                                                    | 15 s   |
| 3   | The invoice, dashboard             | Signed in as the freelancer. One invoice, three line items, total in dollars. "She writes an ordinary invoice. She never mentions a chain."                                                                                                                                                                                                                                 | 15 s   |
| 4   | **The payment, start to finish**   | Client opens the pay link → picks wNEAR → gets the deposit address and the QR → sends → the status moves _Payment detected_ → _Processing_ → _Paid_. Then the receipt. **This is the shot the video exists for; give it the most time.**                                                                                                                                    | 60 s   |
| 5   | Where the money went               | On the receipt: the exact amount in, the exact amount the seller received, the tx reference. "It went to her address. It never went to ours — there is no ours."                                                                                                                                                                                                            | 20 s   |
| 6   | NEAR's role, concretely            | "The swap is a NEAR Intents intent, quoted EXACT_OUTPUT — it states what must _arrive_, so a moving market can't turn a 1,800 dollar invoice into 1,794. Solvers fill it across chains. Sign-in is a NEP-413 signature from a NEAR wallet, and changing the payout address needs a _fresh_ signature over the exact address, so a stolen session can't redirect the money." | 30 s   |
| 7   | One thing that goes wrong, handled | A short payment: the page says what arrived and what is still owed, in numbers. "Because 'send the difference' means nothing without the difference."                                                                                                                                                                                                                       | 20 s   |
| 8   | Try it yourself                    | Terminal: `pnpm install && pnpm demo`. "No keys, no database, no network. The link is in the README." Then the repo and the X post on screen.                                                                                                                                                                                                                               | 20 s   |
| 9   | Next step / ask                    | "We'd like a judge to try paying an invoice from a token they already hold, and tell us which chain we should validate next."                                                                                                                                                                                                                                               | 10 s   |

Recording notes:

- **Three captures exist.** On 2026-11-09: a **silent** cut (88 seconds, 1080p, landing → dashboard → invoices → pay → receipt → short payment → phone, with on-screen captions and a click indicator) and a **narrated** cut (90.7 seconds, the same journey re-recorded so each shot lands with its line — 14 synthesized lines placed at absolute timestamps, H.264 + AAC stereo, 4.6 MB). On **2026-11-10, against the dark S4.15 design**, a third cut: `settle-demo-walkthrough-voiced-2026-11-10.mp4` — a 3.2-second brand intro card, 89.1 seconds of desktop journey, a 6.1-second framed phone segment, and a 5-second "try it yourself" outro; 1920×1080 at 30 fps, H.264 + AAC 48 kHz stereo, **103.3 seconds, 6.96 MB**. Its 14 lines are re-synthesized with macOS `say -v Samantha`; two were rewritten to match what is now on screen, captions and the cursor moved from the old green to the dark-glass/magenta chrome, and the mix is loudness-normalised to −16 LUFS. All three were recorded with Playwright against the production demo build, so all three are honest demo-mode footage with the banner in frame. The 2026-11-10 narrated cut is the one to upload unless a human voice is recorded; if it is, re-record against the new lengths rather than dubbing over the old picture. Substituting the real-payment shot from S8.4 and uploading remain the human's.

- Shoot shot 4 twice: once in **demo mode** (reliable, no funds) and once from the **real payment** in S8.4 if it lands before recording. The real one is stronger; the demo one is the fallback and is honest as long as the banner is visible.
- Keep the "Demo mode — nothing on this page moves money" banner in frame whenever demo data is on screen. That is the difference between a demo and a claim.
- No music under speech. Captions on, because judges skim.
- Export 1080p, under ~60 MB if it has to be attached to the post rather than linked.

---

## 3. X post drafts (S10.3, #83)

The human posts one of these themselves and pastes the URL back (S10.4). Every draft carries
@NEARProtocol and #NEARHackathon, because that is what puts it on the timeline;
@NearLegacy/@NearBuilders are optional amplification and are marked where they'd go.
Character counts include the tags and assume the two links are pasted as-is.

### Option A — problem first, plainest (recommended)

> A freelancer invoices 1,800 USDC. Her client holds wNEAR.
>
> Now an ordinary invoice is a bridge, a gas token and an address format nobody wants to get wrong — and every service that "handles it" holds the money while it crosses.
>
> We built Settle: she writes the invoice in dollars, he pays from any token on any chain, and NEAR Intents solvers deliver the exact amount to her own address. No custody — there is no address of ours in the path.
>
> Built at @NEARProtocol #NEARHackathon
> repo + demo ↓

_~560 characters. Attach the video. Add `@NearLegion @NearBuilders` on a second line before the links if she wants the amplification (+34)._

### Option B — the mechanism leads

> The interesting line in Settle isn't the invoice. It's `swapType: EXACT_OUTPUT`.
>
> A NEAR Intents intent that states what must _arrive_ — 1,800 USDC to this address — instead of what is being sent. So a client can pay in wNEAR, USDT on Solana or ETH on Arbitrum, and a moving market can't quietly turn the invoice into 1,794.
>
> Invoicing software, cross-chain rail underneath, nobody holding your money in the middle.
>
> Built at @NEARProtocol #NEARHackathon
> repo + demo ↓

_~520 characters. Better for a technical timeline; weaker for a judge skimming for "what is this"._

### Option C — short, video does the work

> Invoice: 1,800 USDC. Client's wallet: wNEAR.
>
> Settle turns that into a NEAR Intents intent and the exact amount lands on the freelancer's own address. No custodian, no bridge the client has to understand, no key the app holds.
>
> Built at @NEARProtocol #NEARHackathon — 2 minutes of it working ↓

_~330 characters. Use if the video carries the explanation; needs the video attached, not linked._

Whichever she picks, the links that go with it:

- repository: `https://github.com/MFrancis-dev/settle`
- hosted demo: `https://settle-wine-alpha.vercel.app` (live, real mode; S8.3 done 2026-11-08, re-deployed and browser-verified 2026-11-09).
- avatar / link preview: `public/pfp.png` (1024×1024, the settle mark on the brand green, rendered by `pnpm brand`) is the project pfp. The hosted page already serves it as its Open Graph / Twitter image, so a pasted demo link previews with the mark; if posting from a project account, set it as the avatar.

---

## 4. Submission payload (S10.6, #86) — skeleton, printed for the human

Eleven fields, exactly. No `website` field: the live rules call it a spam trap and any
non-empty value rejects the submission. Every `<…>` is a value only the human can give;
none of it is guessed, generated or filled in with a placeholder before sending.

```json
{
  "requestId": "<generated once with `uuidgen | tr A-Z a-z`, kept for any retry>",
  "projectName": "Settle",
  "leadName": "<team lead's name, 2-80 chars>",
  "email": "<contact email, max 160 chars>",
  "size": "<one of: 1 | 2 - 4 | 4 - 6 | 6 - 8 | 8+, exactly as written>",
  "tracks": ["realworld"],
  "nearAddress": "<mainnet NEAR account for the prize payout, lowercase, e.g. team.near>",
  "projectUrl": "https://github.com/MFrancis-dev/settle",
  "demoUrl": "<URL of the public X demo post, once S10.4 is done>",
  "idea": "<20-2000 chars: the problem, the product, how NEAR fits — draft below>",
  "consent": true
}
```

`consent` is set to `true` only after this sentence has been read to the human and they
agreed: _"I agree that the organizers may use these details to review our submission and
contact us about this hackathon."_

**Draft for `idea` (1,270 characters as sent, measured; inside the 20–2000 limit):**

> A freelancer invoices 1,800 USDC; her client holds wNEAR, or USDT on Solana, or ETH on Arbitrum. An ordinary invoice becomes a crypto problem — which bridge, which gas token, which address format — and every service that "handles it" does so by taking custody, so the freelancer becomes an unsecured creditor of a stranger.
>
> Settle is invoicing software with a cross-chain rail underneath. The freelancer writes a line-item invoice in dollars and gets a pay link. The client picks a token they hold and sends it. NEAR Intents does the rest: we quote 1Click with swapType EXACT_OUTPUT, so the intent states what must _arrive_ — the exact invoice amount, to the freelancer's own address — rather than what is being sent. verifyQuoteSignature() runs before any deposit address is shown, /v0/status is the only source of a status, and solvers refund an overpayment to the client's own address.
>
> Money never touches Settle: no custodial address, no key that can move a deposit, no payout key. NEAR is also the identity layer — NEP-413 sign-in with no password held, and a fresh signature over the exact address and chain required to change where money lands.
>
> One Next.js app plus a worker, 665 offline tests, and `pnpm demo` runs the whole story with no keys and no network.

**Worked example with placeholder values — shape only, do not POST this.**

Every field below that a human decides is filled with an obviously fake value so the body is
valid JSON and the escaping of `idea` (newlines as `\n`, the inner quotes around `"handles it"`
escaped) can be checked without any personal data. It is **not** submittable: `demoUrl` points at
a post that does not exist, `nearAddress` is not a real account, and `consent` is only true once
the human has agreed to the notice above.

```json
{
  "requestId": "00000000-0000-4000-8000-000000000000",
  "projectName": "Settle",
  "leadName": "PLACEHOLDER LEAD NAME",
  "email": "placeholder@example.com",
  "size": "1",
  "tracks": ["realworld"],
  "nearAddress": "placeholder.near",
  "projectUrl": "https://github.com/MFrancis-dev/settle",
  "demoUrl": "https://x.com/PLACEHOLDER/status/0000000000000000000",
  "idea": "A freelancer invoices 1,800 USDC; her client holds wNEAR, or USDT on Solana, or ETH on Arbitrum. An ordinary invoice becomes a crypto problem — which bridge, which gas token, which address format — and every service that \"handles it\" does so by taking custody, so the freelancer becomes an unsecured creditor of a stranger.\n\nSettle is invoicing software with a cross-chain rail underneath. The freelancer writes a line-item invoice in dollars and gets a pay link. The client picks a token they hold and sends it. NEAR Intents does the rest: we quote 1Click with swapType EXACT_OUTPUT, so the intent states what must _arrive_ — the exact invoice amount, to the freelancer's own address — rather than what is being sent. verifyQuoteSignature() runs before any deposit address is shown, /v0/status is the only source of a status, and solvers refund an overpayment to the client's own address.\n\nMoney never touches Settle: no custodial address, no key that can move a deposit, no payout key. NEAR is also the identity layer — NEP-413 sign-in with no password held, and a fresh signature over the exact address and chain required to change where money lands.\n\nOne Next.js app plus a worker, 665 offline tests, and `pnpm demo` runs the whole story with no keys and no network.",
  "consent": true
}
```

Real value, placeholder, and why:

| Field         | In the example                          | Replace with                                                                    |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `requestId`   | all-zero UUID                           | `uuidgen \| tr A-Z a-z`, generated once, reused unchanged on any retry          |
| `projectName` | `Settle`                                | nothing — this one is real                                                      |
| `leadName`    | `PLACEHOLDER LEAD NAME`                 | the team lead's name, 2–80 chars                                                |
| `email`       | `placeholder@example.com`               | the contact email, max 160 chars                                                |
| `size`        | `1`                                     | the team's size, one of `1 \| 2 - 4 \| 4 - 6 \| 6 - 8 \| 8+` exactly as written |
| `tracks`      | `["realworld"]`                         | nothing unless the track choice changes                                         |
| `nearAddress` | `placeholder.near`                      | the mainnet account that should receive a prize, lowercase                      |
| `projectUrl`  | the public repo                         | nothing — this one is real                                                      |
| `demoUrl`     | `https://x.com/PLACEHOLDER/status/000…` | the URL of the public X demo post, once S10.4 is done                           |
| `idea`        | the 1,270-character draft above         | nothing unless the draft is edited; it is inside the 20–2000 limit              |
| `consent`     | `true`                                  | `true` only after the human agrees to the contact notice verbatim               |
| `website`     | absent                                  | keep it absent — any non-empty value rejects the submission                     |

Send once, with `curl -sS -X POST https://nearhackathon.com/api/applications`, only after the
human has confirmed the exact printed payload, and only when the repository is public and the
demo post is up. A 201 means saved; a 400 means fix the fields listed and resend **with the
same `requestId`**; a 409 means it was already submitted and the fix is a request-changes
form, never a second submission.

---

## 5. What is still the human's, in order

Hosting is **done** (S8.1–S8.3, 2026-11-08; re-deployed and browser-verified 2026-11-09) — the live
demo is `https://settle-wine-alpha.vercel.app`, real mode against Neon Postgres. What remains:

1. **S10.2** — record the video from §2 (needs S8.4's real payment if it lands first).
2. **S8.4** — approve and make one small real payment end-to-end; this signs a real transaction, so it needs an explicit yes.
3. **S2.10** — the `storage_deposit` spend, if we want delivery to survive an unregistered payout account. Also a real signature.
4. **S10.4** — post one of §3's drafts on X and paste the URL back.
5. **S10.7** — confirm the printed payload and submit once; keep the `requestId`.
6. **S11.1–S11.3** — keep the demo up to Nov 18 (ideally Nov 25), keep the repo public, watch Discord/X for judge questions.

Before judging (2026-11-16): re-check that the live build is current and re-deploy if stale — deploys
are manual (`vercel --prod`, her account), so a merged PR does not appear on the live URL by itself.
The staleness probe and the deploy command are in `DEPLOY.md` §8.

Also outstanding and not the agent's to do: register for the 1Click partner JWT (Q-006). The leaked
`TemiMustapha` PAT is dead as of 2026-11-10 — GitHub refused it on every authenticated call, and the
dead entry was removed from this machine — so no revocation step remains.
