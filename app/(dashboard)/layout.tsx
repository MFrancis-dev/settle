"use client";

/**
 * The signed-in shell: an "open plane" sidebar on the page ground, no top bar.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5, PRD FR-18 (dashboard is only for the signed-in freelancer)
 *
 * The gate is a session check, not a wallet check. A wallet can name an account while the Settle
 * cookie has expired, and the reverse is true on a different browser — `/api/me` is the only answer
 * that matters, which is why a failed wallet disconnect never logs anybody out here.
 *
 * The sidebar names the product (its mark and wordmark) and the account it is scoped to, holds the
 * primary nav on a 34px pitch, and pushes the account row to the bottom. On a phone it folds into a
 * 48px top bar whose menu button opens a full-screen sheet with the same nav and account.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ApiError } from "@/lib/api/client";
import { useMe, useSignOut } from "@/lib/api/queries";
import { useWallet } from "@/components/wallet/WalletProvider";
import { SignInButton } from "@/components/wallet/SignInButton";
import { Alert } from "@/components/ui/alert";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { Mark } from "@/components/ui/mark";
import { buttonClass } from "@/components/ui/button";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: GridIcon },
  { href: "/invoices", label: "Invoices", icon: InvoiceIcon },
  { href: "/settings", label: "Settings", icon: SlidersIcon },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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
              Settle needs your wallet to sign a message before it shows anything. That does not
              move money and does not give Settle permission to spend anything.
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

  const activeLabel = NAV.find((item) => pathname.startsWith(item.href))?.label ?? "Settle";

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar: on the page ground, one hairline from the canvas. The extra bottom room
          keeps the account row clear of the wallet selector's floating trigger. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line px-3 pt-5 pb-20 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2 px-2 text-ink">
          <Mark />
          <span className="text-base font-semibold tracking-tight">Settle</span>
        </Link>
        <p
          className="mt-3 max-w-full truncate px-2 text-xs text-ink-faint"
          title={me.data.nearAccountId}
        >
          {me.data.displayName}
        </p>

        <nav aria-label="Sections" className="mt-6 flex flex-col gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              active={pathname.startsWith(item.href)}
              icon={item.icon}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 px-2 pt-6">
          {me.data.isDemo ? (
            <p className="text-xs text-ink-faint">Demo mode — nothing here moves money.</p>
          ) : null}
          <SignOut />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone top bar: the screen's name and a menu that opens the full-screen sheet. */}
        <header className="flex h-12 items-center justify-between border-b border-line px-4 lg:hidden">
          <Link href="/dashboard" className="flex items-center gap-2 text-ink">
            <Mark />
            <span className="text-sm font-semibold">{activeLabel}</span>
          </Link>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="rounded-control p-1.5 text-ink-muted hover:bg-control hover:text-ink"
          >
            <MenuIcon />
          </button>
        </header>

        {menuOpen ? (
          <MobileSheet
            nearAccountId={me.data.nearAccountId}
            displayName={me.data.displayName}
            isDemo={me.data.isDemo}
            pathname={pathname}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}

        <div className="flex flex-col gap-4 px-5 pt-5 sm:px-8 lg:px-10 lg:pt-9">
          {me.data.isDemo ? (
            <div className="hidden lg:block">
              <DemoBanner />
            </div>
          ) : null}

          {me.data.payout === null ? (
            <Alert tone="warn" title="No payout address yet">
              Invoices can be created, but a client cannot pay until you choose where the money
              goes.{" "}
              <Link className="underline underline-offset-4" href="/settings">
                Set a payout address
              </Link>
            </Alert>
          ) : null}

          {me.data.isDemo ? (
            <div className="lg:hidden">
              <DemoBanner />
            </div>
          ) : null}
        </div>

        <main id="main" className="flex-1 px-5 py-5 sm:px-8 lg:px-10 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: (props: { className?: string }) => ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-control px-3 py-1.5 text-sm ${
        active ? "bg-control font-medium text-ink" : "text-ink-muted hover:bg-control hover:text-ink"
      }`}
    >
      <Icon className={active ? "text-ink" : "text-ink-faint"} />
      {children}
    </Link>
  );
}

function MobileSheet({
  nearAccountId,
  displayName,
  isDemo,
  pathname,
  onClose,
}: {
  nearAccountId: string;
  displayName: string;
  isDemo: boolean;
  pathname: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas lg:hidden" role="dialog" aria-modal>
      <div className="flex h-12 items-center justify-between border-b border-line px-4">
        <span className="flex items-center gap-2 text-ink">
          <Mark />
          <span className="text-sm font-semibold">Settle</span>
        </span>
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="rounded-control p-1.5 text-ink-muted hover:bg-control hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>
      <nav aria-label="Sections" className="flex flex-col gap-1 p-4">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            aria-current={pathname.startsWith(item.href) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-base ${
              pathname.startsWith(item.href)
                ? "bg-control font-medium text-ink"
                : "text-ink-muted"
            }`}
          >
            <item.icon className="text-ink-faint" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 border-t border-line p-4">
        <p className="truncate text-sm text-ink-muted" title={nearAccountId}>
          {displayName}
        </p>
        {isDemo ? <p className="text-xs text-ink-faint">Demo mode — nothing here moves money.</p> : null}
        <SignOut onDone={onClose} />
      </div>
    </div>
  );
}

function SignOut({ onDone }: { onDone?: () => void }) {
  const signOut = useSignOut();
  const { signOutWallet } = useWallet();

  return (
    <button
      type="button"
      className="self-start text-sm text-ink-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
      disabled={signOut.isPending}
      onClick={async () => {
        await signOut.mutateAsync();
        // Leaving the wallet's own session is separate; if it fails, Settle is still signed out.
        await signOutWallet().catch(() => undefined);
        onDone?.();
      }}
    >
      Sign out
    </button>
  );
}

function Cardish({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </section>
  );
}

/** A 401 is "you are not signed in"; anything else is a real fault and must not look like one. */
function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/* 16px outline icons, ~1.5px stroke — the nav's only ornament. */

function GridIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function InvoiceIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden className={className}>
      <path
        d="M4 1.5h6l3 3V14a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 14V1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.5 7h3M6.5 9.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden className={className}>
      <path d="M2 5h8M12.5 5H14M2 11h2M6.5 11H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden>
      <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden>
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
