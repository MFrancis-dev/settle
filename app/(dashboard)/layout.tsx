/**
 * Signed-in shell: nav to dashboard, invoices, settings.
 * Roadmap: S4.1
 * Status: scaffold — not implemented yet.
 */

import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
