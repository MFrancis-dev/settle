/**
 * Landing: what Settle is, and the two doors in — sign in, or look at a real invoice.
 * Roadmap: S4.1 · Spec: PRD §7 (plain money language, no crypto jargon), §8 (a judge understands the
 * pitch in under a minute)
 *
 * Server-rendered on purpose: the first screen must be readable with the wallet extension still
 * loading, and a judge's first visit is this HTML.
 */

import Link from "next/link";

import { SignInButton } from "@/components/wallet/SignInButton";
import { buttonClass } from "@/components/ui/button";
import { returnPath } from "@/lib/ui/return-path";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // `middleware.ts` sends a signed-out visitor here with the page they asked for in `?next=`; without
  // reading it, everybody who follows a bookmarked `/settings` link lands on the dashboard instead.
  const requested = returnPath((await searchParams).next);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 pb-16 sm:px-8">
      <header className="flex items-center justify-between gap-4 py-5">
        <span className="text-lg font-semibold tracking-tight">Settle</span>
        <SignInButton redirectTo={requested ?? "/dashboard"} size="sm" />
      </header>

      <main id="main" className="flex-1">
        <section className="pt-10 sm:pt-16">
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.1] sm:text-5xl">
            Invoice in dollars. Get paid from any token, on any chain.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-muted">
            Your client pays whatever they already hold — USDC, USDT, DAI, BTC, ETH, NEAR. Settle turns it
            into the amount you asked for and sends it to the address you choose. You see one number: the
            invoice, settled.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <SignInButton redirectTo={requested ?? "/invoices/new"} size="lg" />
            <Link href="/invoices/new" className={buttonClass({ variant: "secondary", size: "lg" })}>
              Write an invoice
            </Link>
          </div>
        </section>

        <section className="mt-16 grid gap-8 sm:grid-cols-3">
          <Step n="1" title="Write the invoice" body="Client name, what you did, the total in dollars. No crypto knowledge needed by either side." />
          <Step n="2" title="They pick a token" body="Your client opens one link and chooses from the tokens they already have. They see the exact amount, the fee, and how long it takes before they send." />
          <Step n="3" title="You get paid" body="The money converts and lands at your address. Both sides get the same receipt, with every transaction on it." />
        </section>

        <section className="mt-16 rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
          <h2 className="text-xl font-semibold">What the client sees</h2>
          <p className="mt-2 max-w-2xl text-ink-muted">
            One page, no account, no app. This is the whole payment flow — the amount is fixed for a few
            minutes, then re-quoted, so nobody pays against an old price.
          </p>
          <dl className="mt-6 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
            <Fact label="Invoice" value="#INV-0001" note="Design work, 3 days" />
            <Fact label="They pay" value="1,500.00 USDC" note="from a wallet they already use" />
            <Fact label="You receive" value="$1,497.80" note="USDC on Arbitrum · fee $2.20" />
          </dl>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Questions a real invoice raises</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <QA
              q="What if they send the wrong amount?"
              a="Short payments are held and reported, never quietly swallowed. Overpayments arrive to you in full. The invoice status says exactly what happened."
            />
            <QA
              q="Can the payout address be changed later?"
              a="Yes — but the change needs your own wallet to sign the new address, and it is kept in a change log. An old signature cannot authorise a different one."
            />
            <QA
              q="Who holds the money?"
              a="Settle never custodies funds. Conversion happens with 1Click Payment, and every step is a transaction you can look up."
            />
            <QA
              q="What does it cost?"
              a="The conversion fee is shown before your client confirms, in dollars, on the same screen as the amount they are sending."
            />
          </div>
        </section>
      </main>

      <footer className="mt-16 border-t border-line pt-6 text-sm text-ink-faint">
        <p>
          Settle is an invoicing tool for freelancers paid in digital assets.{" "}
          <Link className="underline underline-offset-4 hover:text-ink" href="/demo">
            Demo
          </Link>
        </p>
      </footer>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <p className="money text-sm font-semibold text-brand">{n}</p>
      <h2 className="mt-1 text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="money mt-1 font-semibold">{value}</dd>
      <dd className="mt-0.5 text-xs text-ink-muted">{note}</dd>
    </div>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <h3 className="font-medium">{q}</h3>
      <p className="mt-1 text-sm text-ink-muted">{a}</p>
    </div>
  );
}
