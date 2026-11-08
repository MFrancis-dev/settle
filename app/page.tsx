/**
 * Landing: what Settle is, and the two doors in — sign in, or look at a real invoice.
 * Roadmap: S4.1, S4.10 · Spec: PRD §7 (plain money language, no crypto jargon), §8 (a judge
 * understands the pitch in under a minute)
 *
 * Design (S4.10): one motif — the settle mark, an arrow descending onto a rule — runs the page as the
 * hero's picture, the diagram, the bullets and the closing construction. The page's "photographs" are
 * the product's own screens (receipt, token picker, pay page, deposit panel), built in HTML.
 *
 * Server-rendered on purpose: the first screen must be readable with the wallet extension still
 * loading, and a judge's first visit is this HTML.
 */

import Link from "next/link";

import { SignInButton } from "@/components/wallet/SignInButton";
import { buttonClass } from "@/components/ui/button";
import { Mark } from "@/components/ui/mark";
import { returnPath } from "@/lib/ui/return-path";
import { ReceiptDemo } from "@/components/landing/ReceiptDemo";
import { TokenPickerDemo } from "@/components/landing/TokenPickerDemo";
import { ClientViewDemo } from "@/components/landing/ClientViewDemo";
import { Reveal } from "@/components/landing/Reveal";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // `middleware.ts` sends a signed-out visitor here with the page they asked for in `?next=`; without
  // reading it, everybody who follows a bookmarked `/settings` link lands on the dashboard instead.
  const requested = returnPath((await searchParams).next);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-16 sm:px-8">
      <header className="flex items-center justify-between gap-4 py-5">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
          <Mark />
          Settle
        </span>
        <nav className="flex items-center gap-2">
          <Link
            href="/demo"
            className="hidden rounded-control px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-control hover:text-ink sm:inline-flex"
          >
            Demo
          </Link>
          <SignInButton redirectTo={requested ?? "/dashboard"} size="sm" />
        </nav>
      </header>

      <main id="main" className="flex-1">
        {/* Hero: the pitch on the left, the receipt — Settle's output — as the picture on the right. */}
        <section className="grid gap-10 pt-8 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center lg:gap-14">
          <div>
            <h1 className="text-3xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              <span className="block">Invoice in dollars.</span>
              <span className="block">Paid in any token.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink">
              Your client pays whatever they already hold — USDC, USDT, BTC, ETH, NEAR. Settle
              converts it and sends the exact amount to the address you choose. You see one number:
              the invoice, settled.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <SignInButton redirectTo={requested ?? "/invoices/new"} size="lg" />
              <Link
                href="/invoices/new"
                className={buttonClass({ variant: "secondary", size: "lg" })}
              >
                Write an invoice
              </Link>
            </div>
          </div>
          <Reveal delay={120}>
            <ReceiptDemo />
          </Reveal>
        </section>

        {/* How it works: the product's own progress, enlarged into one bar. */}
        <section className="mt-20 sm:mt-28">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <div data-ui className="mt-6 flex flex-col gap-1.5 sm:h-44 sm:flex-row">
            <Reveal style={{ flexGrow: 1 }} className="flex">
              <Stage
                tone="sunk"
                duration="Two minutes"
                title="Write the invoice"
                body="Client, what you did, the total in dollars. No crypto knowledge needed by either side."
              />
            </Reveal>
            <Reveal style={{ flexGrow: 2 }} delay={120} className="flex">
              <Stage
                tone="control"
                duration="A few minutes"
                title="They pick a token"
                body="One link. They choose from the tokens they already hold and see the exact amount and fee before they send."
              />
            </Reveal>
            <Reveal style={{ flexGrow: 2 }} delay={240} className="flex">
              <Stage
                tone="brand"
                duration="Settled"
                title="You get paid"
                body="The money converts and lands at your address. Both sides get the same receipt."
              />
            </Reveal>
          </div>
        </section>

        {/* The one live thing: the client's token choice, working. */}
        <section className="mt-20 sm:mt-28">
          <div className="rounded-card border border-line bg-surface-sunk p-6 sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center lg:gap-12">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  They pay what they hold.
                </h2>
                <p className="mt-3 max-w-md text-base text-ink">
                  Pick a token and the deposit amount follows — for the same $1,500 invoice. The
                  price is shown before your client confirms, in dollars, on the same screen as the
                  amount they are sending.
                </p>
              </div>
              <Reveal delay={100}>
                <TokenPickerDemo />
              </Reveal>
            </div>
          </div>
        </section>

        {/* What the client sees: the real pay page and the deposit panel. */}
        <section className="mt-20 sm:mt-28">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            What the client sees
          </h2>
          <p className="mt-3 max-w-2xl text-base text-ink">
            One page, no account, no app. This is the whole payment flow — the amount is fixed for a
            few minutes, then re-quoted, so nobody pays against an old price.
          </p>
          <Reveal>
            <div className="mt-6">
              <ClientViewDemo />
            </div>
          </Reveal>
        </section>

        {/* Questions a real invoice raises. */}
        <section className="mt-20 sm:mt-28">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Questions a real invoice raises
          </h2>
          <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <Reveal>
              <QA
                q="What if they send the wrong amount?"
                a="Short payments are held and reported, never quietly swallowed. Overpayments arrive to you in full. The invoice status says exactly what happened."
              />
            </Reveal>
            <Reveal delay={80}>
              <QA
                q="Can the payout address be changed later?"
                a="Yes — but the change needs your own wallet to sign the new address, and it is kept in a change log. An old signature cannot authorise a different one."
              />
            </Reveal>
            <Reveal delay={160}>
              <QA
                q="Who holds the money?"
                a="Settle never custodies funds. Conversion happens with 1Click Payment, and every step is a transaction you can look up."
              />
            </Reveal>
            <Reveal delay={240}>
              <QA
                q="What does it cost?"
                a="The conversion fee is shown before your client confirms, in dollars, on the same screen as the amount they are sending."
              />
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="mt-24 pt-4 sm:mt-32">
        <LargeMark />
        <div className="mt-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:flex sm:gap-8">
            <Link className="text-ink-muted hover:text-ink" href="/demo">
              Demo
            </Link>
            <Link className="text-ink-muted hover:text-ink" href="/invoices/new">
              Write an invoice
            </Link>
            <Link className="text-ink-muted hover:text-ink" href="/dashboard">
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

function Stage({
  tone,
  duration,
  title,
  body,
}: {
  tone: "sunk" | "control" | "brand";
  duration: string;
  title: string;
  body: string;
}) {
  const tones = {
    sunk: "bg-surface-sunk text-ink",
    control: "bg-control text-ink",
    brand: "bg-brand text-ink-invert",
  } as const;
  const muted = tone === "brand" ? "text-ink-invert/80" : "text-ink-muted";
  return (
    <div
      className={`flex h-full w-full min-h-28 flex-col justify-between rounded-card p-5 sm:min-h-0 ${tones[tone]}`}
    >
      <p className={`text-sm font-semibold ${tone === "brand" ? "text-ink-invert" : "text-ink"}`}>
        {duration}
      </p>
      <div className="mt-6">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className={`mt-1 text-sm ${muted}`}>{body}</p>
      </div>
    </div>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold">{q}</h3>
      <p className="mt-2 text-base text-ink">{a}</p>
    </div>
  );
}

/** The mark built large: the settle motif as a construction that closes the page. */
function LargeMark() {
  return (
    <svg
      viewBox="0 0 640 120"
      className="h-24 w-full text-ink sm:h-28"
      fill="none"
      aria-hidden
      preserveAspectRatio="xMinYMid meet"
    >
      {/* the rule the money lands on */}
      <path d="M8 96h624" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* the arrow descending onto it */}
      <path
        d="M120 16v62M120 78 96 54M120 78l24-24"
        stroke="var(--color-brand)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the wordmark, set beside the motif */}
      <text
        x="176"
        y="86"
        fill="currentColor"
        style={{ font: "600 64px Geist, sans-serif", letterSpacing: "-0.02em" }}
      >
        Settle
      </text>
    </svg>
  );
}
