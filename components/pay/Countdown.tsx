"use client";

/**
 * The clock on a payment address.
 * Roadmap: S4.4 · Spec: PRD FR-15 (the quote expires and says so), ARCHITECTURE.md §3.2
 *
 * It counts down to the deadline the *server* put on the quote — the client's page never decides how
 * long a price lasts. `onExpire` fires once so the screen can offer a new quote instead of leaving a
 * dead address on screen.
 */

import { useEffect, useRef, useState } from "react";

function remainingMs(deadline: string, now: number): number {
  const at = Date.parse(deadline);
  return Number.isNaN(at) ? 0 : at - now;
}

export function Countdown({ deadline, onExpire }: { deadline: string; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, [deadline]);

  const left = remainingMs(deadline, now);
  const expired = left <= 0;

  useEffect(() => {
    if (expired && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  if (expired) {
    return (
      <p className="text-sm font-medium text-warn" role="status">
        This price has expired.
      </p>
    );
  }

  const total = Math.floor(left / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return (
    <p className={`money text-sm ${minutes <= 2 ? "font-medium text-warn" : "text-ink-muted"}`}>
      <span aria-hidden>{`${minutes}:${String(seconds).padStart(2, "0")}`}</span>
      <span className="sr-only">{`Price holds for ${minutes} minutes and ${seconds} seconds.`}</span>
    </p>
  );
}
