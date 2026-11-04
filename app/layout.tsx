/**
 * Root layout.
 * Roadmap: S4.1
 * Status: scaffold — not implemented yet.
 */

import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Settle", description: "Get paid in dollars, from any token on any chain." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
