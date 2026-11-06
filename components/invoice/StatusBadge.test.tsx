// @vitest-environment jsdom
/**
 * Every status the API can return has to render as words a person understands.
 * Roadmap: S4.8 · Spec: PRD §7 (plain money words), FR-19
 *
 * The labels come from `lib/ui/status.ts`, which switches both unions exhaustively; this test walks the
 * unions themselves, so a status added to `lib/core/status.ts` shows up here as a blank pill.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ATTEMPT_STATUSES, INVOICE_STATUSES } from "@/lib/core/status";

import { AttemptStatusBadge, StatusBadge } from "./StatusBadge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("names every invoice status in words, never as the raw value", () => {
    for (const status of INVOICE_STATUSES) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const label = container.textContent?.trim() ?? "";
      expect(label.length, status).toBeGreaterThan(1);
      expect(label, status).not.toBe(status);
      expect(label.toLowerCase(), status).not.toContain("undefined");
      unmount();
    }
  });

  it("names every payment-attempt status in words, never as the raw value", () => {
    for (const status of ATTEMPT_STATUSES) {
      const { container, unmount } = render(<AttemptStatusBadge status={status} />);
      const label = container.textContent?.trim() ?? "";
      expect(label.length, status).toBeGreaterThan(1);
      expect(label, status).not.toBe(status);
      unmount();
    }
  });

  it("keeps the state in the text, so colour is never the only signal", () => {
    const { container } = render(<StatusBadge status="payment_detected" />);
    const pill = container.querySelector("span");
    expect(pill?.textContent?.trim().length ?? 0).toBeGreaterThan(1);
  });
});
