/**
 * Status pill.
 * Roadmap: S4.3, S4.5
 *
 * Colour is never the only signal: the label text carries the state and the tone classes only add
 * emphasis. Callers take the tone from `lib/ui/status.ts`, which switches the status unions
 * exhaustively.
 */

import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui/status";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunk text-ink-muted border-line",
  info: "bg-info-soft text-info border-info/25",
  success: "bg-brand-soft text-brand border-brand/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  danger: "bg-danger-soft text-danger border-danger/25",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
