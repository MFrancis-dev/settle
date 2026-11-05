/**
 * Inline notice: the warning a pay page shows about withdrawal fees, and the line that says a
 * payment arrived short.
 * Roadmap: S4.4, S4.5 · Spec: PRD FR-14, FR-10
 *
 * `warn` and `danger` announce themselves (`role="alert"`); a plain information line must not, or
 * every status change would interrupt a screen reader.
 */

import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui/status";

const ALERT_TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunk text-ink border-line",
  info: "bg-info-soft text-info border-info/30",
  success: "bg-brand-soft text-brand border-brand/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-danger-soft text-danger border-danger/30",
};

export function Alert({
  tone = "info",
  title,
  children,
  actions,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const announce = tone === "warn" || tone === "danger";
  return (
    <div
      role={announce ? "alert" : "status"}
      className={`rounded-card border px-4 py-3 text-sm ${ALERT_TONES[tone]}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="mt-1 space-y-2 leading-relaxed">{children}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
