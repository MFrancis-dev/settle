"use client";

/**
 * The signed-in shell: navigation, the account, and the one gate every page behind it shares.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5, PRD FR-18 (dashboard is only for the signed-in freelancer)
 *
 * The gate is a session check, not a wallet check. A wallet can name an account while the Settle
 * cookie has expired, and the reverse is true on a different browser — `/api/me` is the only answer
 * that matters, which is why a failed wallet disconnect never logs anybody out here.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ApiError } from "@/lib/api/client";
import { useMe, useSignOut } from "@/lib/api/queries";
import { useWallet } from "@/components/wallet/WalletProvider";
import { SignInButton } from "@/components/wallet/SignInButton";
import { Alert } from "@/components/ui/alert";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { buttonClass } from "@/components/ui/button";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/invoices", label: "Invoices" },
  { href: "/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16 text-sm text-ink-muted sm:px-8">
        Loading your account…
      </div>
    );
  }

  if (me.isError) {
    return (
      <main id="main" className="mx-auto w-full max-w-lg px-5 py-16 sm:px-8">
        {isUnauthorized(me.error) ? (
          <Cardish title="Sign in to see your invoices">
            <p className="text-sm text-ink-muted">
              Settle needs your wallet to sign a message before it shows anything. That does not move money
              and does not give Settle permission to spend anything.
            </p>
            <div className="mt-4">
              <SignInButton redirectTo={pathname} />
            </div>
          </Cardish>
        ) : (
          <Alert tone="danger" title="Settle could not read your account">
            {me.error instanceof Error ? me.error.message : "Unknown error."}
            <div className="mt-3">
              <Link href="/dashboard" className={buttonClass({ variant: "secondary", size: "sm" })}>
                Try again
              </Link>
            </div>
          </Alert>
        )}
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          Settle
        </Link>
        <nav aria-label="Sections" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-2 sm:w-auto">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} active={pathname.startsWith(item.href)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="order-2 flex items-center gap-3 sm:order-3">
          <span className="hidden max-w-[18rem] truncate text-sm text-ink-muted sm:inline" title={me.data.nearAccountId}>
            {me.data.displayName}
          </span>
          <SignOut />
        </div>
      </header>

      {me.data.isDemo ? (
        <div className="mt-4">
          <DemoBanner />
        </div>
      ) : null}

      {me.data.payout === null ? (
        <div className="mt-4">
          <Alert tone="warn" title="No payout address yet">
            Invoices can be created, but a client cannot pay until you choose where the money goes.{" "}
            <Link className="underline underline-offset-4" href="/settings">
              Set a payout address
            </Link>
          </Alert>
        </div>
      ) : null}

      <main id="main" className="flex-1 py-6">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-control px-3 py-1.5 text-sm ${
        active ? "bg-surface-sunk font-medium text-ink" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function SignOut() {
  const signOut = useSignOut();
  const { signOutWallet } = useWallet();

  return (
    <button
      type="button"
      className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
      disabled={signOut.isPending}
      onClick={async () => {
        await signOut.mutateAsync();
        // Leaving the wallet's own session is separate; if it fails, Settle is still signed out.
        await signOutWallet().catch(() => undefined);
      }}
    >
      Sign out
    </button>
  );
}

function Cardish({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </section>
  );
}

/** A 401 is "you are not signed in"; anything else is a real fault and must not look like one. */
function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
