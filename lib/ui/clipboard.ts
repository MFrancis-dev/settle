/**
 * Copy-to-clipboard, with a path that works when the browser will not hand out the Clipboard API.
 * Roadmap: S4.4 · Spec: PRD FR-14 (deposit address: copy + QR)
 *
 * The Clipboard API only exists on a secure origin, and a demo over plain http is not one, so the
 * fallback selects a throwaway field and issues the legacy copy command. If both fail the caller says
 * "select it and copy", rather than reporting a copy that never happened.
 */

export type CopyOutcome = "copied" | "manual";

export async function copyToClipboard(text: string): Promise<CopyOutcome> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // A background tab or a denied permission throws; fall through to the legacy path.
    }
  }
  if (typeof document === "undefined") return "manual";

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "-1000px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  return copied ? "copied" : "manual";
}
