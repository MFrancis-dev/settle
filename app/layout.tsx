/**
 * Root layout: the shell every page shares.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §2, PRD §7 (mobile first, plain language)
 *
 * Providers are a client component; this file stays on the server so the document metadata and the
 * first byte of HTML need no JavaScript.
 */

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "@near-wallet-selector/modal-ui/styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Settle — invoice in dollars, paid in any token", template: "%s · Settle" },
  description:
    "Send an invoice in dollars. Your client pays from any token on any chain, and you get paid at the address you choose.",
  applicationName: "Settle",
};

/** Pinch-zoom stays enabled; the pay page is used on a phone in front of a client. */
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
