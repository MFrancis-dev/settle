"use client";

/**
 * Copy button with an announced result.
 * Roadmap: S4.4 · Spec: PRD FR-14
 *
 * It never claims success it did not get: `copyToClipboard` returns whether the browser really took
 * the text, and the label says "select and copy" when it did not.
 */

import { useEffect, useRef, useState } from "react";

import { copyToClipboard, type CopyOutcome } from "@/lib/ui/clipboard";
import { buttonClass } from "./button";

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  async function onClick() {
    const result = await copyToClipboard(value);
    setOutcome(result);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome(null), 4_000);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${buttonClass({ variant: "secondary", size })} whitespace-nowrap`}
    >
      {outcome === "copied" ? "Copied" : outcome === "manual" ? "Select it and press Ctrl+C" : label}
    </button>
  );
}
