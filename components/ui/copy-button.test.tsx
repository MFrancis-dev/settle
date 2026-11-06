// @vitest-environment jsdom
/**
 * The copy button must never claim a copy that did not happen.
 * Roadmap: S4.8 · Spec: PRD FR-14 (deposit address: copy + QR), AGENTS.md §6 (report honestly)
 *
 * jsdom has no Clipboard API, which is the same situation as a demo served over plain http, so the
 * default case here is the fallback path rather than a mock.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CopyButton } from "./copy-button";

afterEach(cleanup);

describe("CopyButton", () => {
  it("says what it was asked to say until it is pressed", () => {
    render(<CopyButton value="deposit.near" label="Copy address" />);
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
  });

  it("reports a real copy when the browser took the text", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    render(<CopyButton value="memo-42" label="Copy memo" />);

    await userEvent.click(screen.getByRole("button", { name: "Copy memo" }));
    expect(written).toEqual(["memo-42"]);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("falls back to telling the person to copy it themselves", async () => {
    render(<CopyButton value="memo-42" label="Copy memo" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy memo" }));
    expect(screen.getByRole("button", { name: "Select it and press Ctrl+C" })).toBeTruthy();
  });
});
