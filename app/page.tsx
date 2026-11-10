/**
 * Landing: what Settle is, and the two doors in — sign in, or try the demo.
 * Roadmap: S4.1, S4.10, S4.13 · Spec: PRD §7 (plain money language, no crypto jargon), §8 (a judge
 * understands the pitch in under a minute)
 *
 * Design (S4.13): the reference is a night-ground exchange platform — near-black, one magenta shaft
 * of light behind a centred statement, glass cards on a hairline border, pill actions. Settle keeps
 * its own subject: the hero's picture is the real pay page (a client choosing a token), the receipt
 * is left as a white paper document on the dark, and every number on the page adds up. The magenta
 * never touches data — money that arrived stays brand green, which is why the receipt reads as paper
 * and not as another dark panel.
 *
 * Server-rendered on purpose: the first screen must be readable with the wallet extension still
 * loading, and a judge's first visit is this HTML.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { SignInButton } from "@/components/wallet/SignInButton";
import { buttonClass } from "@/components/ui/button";
import { Mark } from "@/components/ui/mark";
import { returnPath } from "@/lib/ui/return-path";
import { ReceiptDemo } from "@/components/landing/ReceiptDemo";
import { TokenPickerDemo } from "@/components/landing/TokenPickerDemo";
import { ClientViewDemo } from "@/components/landing/ClientViewDemo";
import { Reveal } from "@/components/landing/Reveal";

const CHAINS = ["NEAR", "Ethereum", "Base", "Arbitrum", "Solana"];

const TOKENS = [
  { symbol: "USDC", chain: "Arbitrum", className: "left-1 top-14" },
  { symbol: "USDT", chain: "Ethereum", className: "right-1 top-32" },
  { symbol: "wNEAR", chain: "NEAR", className: "left-3 bottom-24" },
  { symbol: "BTC", chain: "Bitcoin", className: "right-2 bottom-10" },
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // `middleware.ts` sends a signed-out visitor here with the page they asked for in `?next=`; without
  // reading it, everybody who follows a bookmarked `/settings` link lands on the dashboard instead.
  const requested = returnPath((await searchParams).next);

  return (
    <div className="night relative flex min-h-screen w-full flex-col overflow-x-clip bg-canvas text-ink">
      <Backdrop />

      <header className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="flex items-center justify-between gap-4 py-5">
          <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Mark tone="current" />
            Settle
          </span>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/demo"
              className="hidden rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-control hover:text-ink sm:inline-flex"
            >
              Demo
            </Link>
            <Link
              href="#how"
              className="hidden rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-control hover:text-ink md:inline-flex"
            >
              How it works
            </Link>
            <Link
              href="#questions"
              className="hidden rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-control hover:text-ink md:inline-flex"
            >
              Questions
            </Link>
            <SignInButton redirectTo={requested ?? "/dashboard"} size="sm" variant="accent" pill />
          </nav>
        </div>
      </header>

      <main id="main" className="relative z-10 w-full flex-1">
        {/* Hero: the statement, then the real pay page floating on the light. */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pt-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] px-3.5 py-1.5 text-xs text-ink-muted backdrop-blur">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Non-custodial invoicing · built on NEAR Intents
            </p>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
              <span className="block">Invoice in dollars.</span>
              <span className="block bg-gradient-to-r from-[#ff9ae6] via-[#f067d4] to-[#a06bff] bg-clip-text text-transparent">
                Paid in any token.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-base text-ink-muted sm:text-lg">
              Your client pays whatever they already hold — USDC, USDT, BTC, ETH, NEAR. Settle
              converts it and sends the exact amount to the address you choose. You see one number:
              the invoice, settled.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <SignInButton
                redirectTo={requested ?? "/invoices/new"}
                size="lg"
                variant="accent"
                pill
              />
              <Link
                href="/demo"
                className={buttonClass({ variant: "outline", size: "lg", pill: true })}
              >
                See the demo
              </Link>
            </div>
          </div>

          {/* The stage: Settle's real pay screen, its client-side panel, and the tokens it feeds. */}
          <div className="relative mx-auto mt-14 max-w-6xl sm:mt-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 -top-8 bottom-2 rounded-[3rem] opacity-70 blur-3xl"
              style={{
                background:
                  "radial-gradient(50% 60% at 50% 20%, rgba(233,78,205,0.45), rgba(120,60,255,0.18) 55%, transparent 80%)",
              }}
            />
            {TOKENS.map((token) => (
              <div
                key={token.symbol}
                aria-hidden
                className={`absolute z-0 hidden w-16 flex-col items-center gap-1.5 text-center xl:flex ${token.className}`}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-[#121019] text-sm font-semibold shadow-[0_10px_40px_-10px_rgba(233,78,205,0.7)]">
                  {token.symbol.slice(0, 1)}
                </span>
                <span className="text-[11px] font-medium text-ink-muted">{token.symbol}</span>
                <span className="text-[10px] text-ink-faint">{token.chain}</span>
              </div>
            ))}

            <div className="relative z-10 mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/[0.04] p-1.5 shadow-[0_40px_120px_-40px_rgba(233,78,205,0.55)] backdrop-blur sm:p-2.5">
              <div className="rounded-[1.6rem] bg-surface p-4 sm:p-6">
                <div className="flex items-center justify-between gap-3 pb-4">
                  <p className="text-sm font-medium text-ink">Invoice #INV-0001 · $1,500.00</p>
                  <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-faint">
                    pay.settle
                  </span>
                </div>
                <ClientViewDemo />
              </div>
            </div>
          </div>

          {/* The chains are part of the promise, so they are stated, not implied by logos. */}
          <div className="mx-auto mt-8 flex max-w-4xl flex-col items-center justify-between gap-3 rounded-2xl border border-line bg-white/[0.02] px-5 py-4 text-sm sm:mt-10 sm:flex-row">
            <p className="text-ink-faint">
              <span className="mr-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                Settles to
              </span>
              <span className="text-ink-muted">{CHAINS.join(" · ")}</span>
            </p>
            <p className="text-ink-faint">
              <span className="mr-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                Refunds also on
              </span>
              <span className="text-ink-muted">Bitcoin</span>
            </p>
          </div>
        </section>

        {/* How it works: three glass panels, each one a step of a real invoice. */}
        <section
          id="how"
          className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 pb-16 pt-8 sm:px-8 sm:pb-24 sm:pt-12"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="max-w-lg text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
              Three steps, and only the first one is yours.
            </h2>
            <p className="max-w-sm text-sm text-ink-muted">
              The client never installs anything, and never has to learn which chain their money is
              on.
            </p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <Reveal className="h-full">
              <Step
                step="01"
                duration="Two minutes"
                title="Write the invoice"
                body="Client, what you did, the total in dollars. No crypto knowledge needed by either side."
              />
            </Reveal>
            <Reveal delay={100} className="h-full">
              <Step
                step="02"
                duration="A few minutes"
                title="They pick a token"
                body="One link. They choose from the tokens they already hold and see the exact amount and fee before they send."
              />
            </Reveal>
            <Reveal delay={200} className="h-full">
              <Step
                step="03"
                duration="Settled"
                title="You get paid"
                body="The money converts and lands at your address. Both sides get the same receipt."
                settled
              />
            </Reveal>
          </div>
        </section>

        {/* The one live thing: the client's token choice, working. */}
        <section className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <div className="relative overflow-hidden rounded-[2rem] border border-line bg-white/[0.03] p-6 sm:p-10">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
            />
            <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                  Live, right here
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                  They pay what they hold.
                </h2>
                <p className="mt-4 max-w-md text-base text-ink-muted">
                  Pick a token and the deposit amount follows — for the same $1,500 invoice. The
                  price is shown before your client confirms, in dollars, on the same screen as the
                  amount they are sending.
                </p>
                <p className="mt-4 text-sm text-ink-faint">
                  Illustrative fixed rates, chosen so the figures add up — this is the interaction,
                  not a live quote.
                </p>
              </div>
              <Reveal delay={100}>
                <TokenPickerDemo />
              </Reveal>
            </div>
          </div>
        </section>

        {/* The statement: one sentence, given the room the shaft is pointing at. */}
        <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <p className="mx-auto max-w-4xl text-balance text-center text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
              Getting paid shouldn&rsquo;t require a{" "}
              <span className="bg-gradient-to-r from-[#ff9ae6] to-[#a06bff] bg-clip-text text-transparent">
                crypto education.
              </span>
            </p>
          </Reveal>
        </section>

        {/* The receipt: the one paper object in the night, because it is what leaves the browser. */}
        <section className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                The same numbers, twice
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                The receipt both sides keep.
              </h2>
              <p className="mt-4 max-w-md text-base text-ink-muted">
                What the client paid, what the conversion cost, what you received — the same three
                numbers on both screens, and every step is a transaction you can look up. That is
                what replaces &ldquo;trust me&rdquo;.
              </p>
              <p className="mt-4 max-w-md text-sm text-ink-faint">
                The receipt is a plain page with a print stylesheet. No app, no account, no login.
              </p>
            </div>
            <Reveal delay={100}>
              <div className="paper rounded-card border border-white/10 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
                <ReceiptDemo />
              </div>
            </Reveal>
          </div>
        </section>

        {/* What the client never has to think about. */}
        <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-4 md:grid-cols-3">
            <Feature
              index="A"
              title="Non-custodial"
              body="The quote's recipient is your address and refunds go back to the client's. There is no Settle address in the path of your money."
              visual={<CustodyPath />}
            />
            <Feature
              index="B"
              title="Fee up front"
              body="The conversion fee is in dollars, on the same screen as the amount they send, before they confirm. No surprise at the end."
              visual={<FeeRows />}
            />
            <Feature
              index="C"
              title="Signed payouts"
              body="Changing the payout address needs a fresh signature from your wallet over that exact address, and it is kept in a change log."
              visual={<SignedPayout />}
            />
          </div>
        </section>

        {/* Questions a real invoice raises. */}
        <section
          id="questions"
          className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 pb-20 sm:px-8 sm:pb-24"
        >
          <h2 className="max-w-lg text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Questions a real invoice raises
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Reveal className="h-full">
              <QA
                q="What if they send the wrong amount?"
                a="Short payments are held and reported, never quietly swallowed. Overpayments arrive to you in full. The invoice status says exactly what happened."
              />
            </Reveal>
            <Reveal delay={80} className="h-full">
              <QA
                q="Can the payout address be changed later?"
                a="Yes — but the change needs your own wallet to sign the new address, and it is kept in a change log. An old signature cannot authorise a different one."
              />
            </Reveal>
            <Reveal delay={160} className="h-full">
              <QA
                q="Who holds the money?"
                a="Settle never custodies funds. Conversion happens with 1Click Payment, and every step is a transaction you can look up."
              />
            </Reveal>
            <Reveal delay={240} className="h-full">
              <QA
                q="What does it cost?"
                a="The conversion fee is shown before your client confirms, in dollars, on the same screen as the amount they are sending."
              />
            </Reveal>
          </div>
        </section>

        {/* The close: the shaft again, one sentence, two doors. */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8 sm:pb-24">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 px-6 py-16 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(70% 120% at 50% 0%, rgba(233,78,205,0.30), rgba(120,60,255,0.10) 45%, transparent 75%)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-full opacity-[0.12]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 10px)",
                maskImage: "linear-gradient(to bottom, black, transparent 80%)",
                WebkitMaskImage: "linear-gradient(to bottom, black, transparent 80%)",
              }}
            />
            <div className="relative">
              <ClosingMark />
              <h2 className="mt-8 text-3xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
                The invoice, settled.
              </h2>
              <p className="mx-auto mt-4 max-w-md text-base text-ink-muted sm:text-lg">
                Write an invoice in dollars. Get paid the exact amount, at your own address.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <SignInButton
                  redirectTo={requested ?? "/invoices/new"}
                  size="lg"
                  variant="accent"
                  pill
                />
                <Link
                  href="/demo"
                  className={buttonClass({ variant: "outline", size: "lg", pill: true })}
                >
                  See the demo
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-6 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Link className="text-ink-muted transition-colors hover:text-ink" href="/demo">
              Demo
            </Link>
            <Link className="text-ink-muted transition-colors hover:text-ink" href="/invoices/new">
              Write an invoice
            </Link>
            <Link className="text-ink-muted transition-colors hover:text-ink" href="/dashboard">
              Sign in
            </Link>
          </div>
          <p className="text-sm text-ink-faint">
            Settle is an invoicing tool for freelancers paid in digital assets.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** The night ground: one magenta shaft of light, a faint grid, and no pictures pretending to be data. */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[1200px] overflow-hidden"
    >
      <div
        className="absolute left-1/2 top-0 h-[900px] w-[640px] -translate-x-1/2 blur-[1px]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 9px)",
          maskImage: "linear-gradient(to bottom, black, transparent 88%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 88%)",
        }}
      />
      <div
        className="absolute left-1/2 top-[-360px] h-[820px] w-[980px] -translate-x-1/2 rounded-full blur-[70px]"
        style={{
          background:
            "radial-gradient(closest-side, rgba(233,78,205,0.40), rgba(160,80,225,0.16) 48%, transparent 76%)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[900px]"
        style={{
          background: "radial-gradient(ellipse at top, rgba(120,70,255,0.12), transparent 62%)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[820px] opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "linear-gradient(to bottom, black, transparent 72%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 72%)",
        }}
      />
    </div>
  );
}

function Step({
  step,
  duration,
  title,
  body,
  settled = false,
}: {
  step: string;
  duration: string;
  title: string;
  body: string;
  settled?: boolean;
}) {
  return (
    <div className="flex h-full flex-col justify-between rounded-card border border-line bg-white/[0.03] p-6 backdrop-blur">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-faint">{step}</span>
        <span
          className={
            settled
              ? "rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand-strong"
              : "rounded-full border border-line px-2.5 py-1 text-ink-muted"
          }
        >
          {duration}
        </span>
      </div>
      <div className="mt-12">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-ink-muted">{body}</p>
      </div>
    </div>
  );
}

function Feature({
  index,
  title,
  body,
  visual,
}: {
  index: string;
  title: string;
  body: string;
  visual: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-card border border-line bg-white/[0.02] p-6">
      <span className="font-mono text-xs text-ink-faint">{index}</span>
      <h3 className="mt-6 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      <div className="mt-auto pt-6">{visual}</div>
    </div>
  );
}

/** The path money takes, drawn: two ends and nothing of ours between them. */
function CustodyPath() {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-ink-muted">
          Invoice
        </span>
        <span className="h-px flex-1 border-t border-dashed border-line-strong" />
        <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-ink-muted">
          Your address
        </span>
      </div>
      <p className="mt-2 text-right text-[10px] text-ink-faint">nothing of ours in between</p>
    </div>
  );
}

/** The three numbers, in the order the client reads them. */
function FeeRows() {
  return (
    <dl className="space-y-1.5 text-[11px]">
      <div className="flex justify-between text-ink-faint">
        <dt>They send</dt>
        <dd className="money">1,500.00 USDC</dd>
      </div>
      <div className="flex justify-between text-ink-faint">
        <dt>Fee</dt>
        <dd className="money">$2.20</dd>
      </div>
      <div className="flex justify-between border-t border-line pt-1.5 text-ink-muted">
        <dt>You receive</dt>
        <dd className="money font-semibold text-brand">$1,497.80</dd>
      </div>
    </dl>
  );
}

/** A payout address only a new signature can move. */
function SignedPayout() {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="rounded-control border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] text-ink-muted">
        you.near
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-medium text-brand-strong">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
          <path
            d="M2.5 6.5 5 9l4.5-6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        signed by your wallet
      </span>
    </div>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div className="h-full rounded-card border border-line bg-white/[0.02] p-6">
      <h3 className="text-base font-semibold">{q}</h3>
      <p className="mt-2 text-sm text-ink-muted">{a}</p>
    </div>
  );
}

/** The mark built large on the closing field: the construction that ends the page. */
function ClosingMark() {
  return (
    <svg
      viewBox="0 0 240 200"
      className="mx-auto h-28 w-40 text-ink sm:h-32 sm:w-48"
      fill="none"
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      {/* the rule the money lands on */}
      <path d="M20 160h200" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      {/* the arrow descending onto it */}
      <path
        d="M120 30v100M120 130 88 98M120 130l32-32"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
