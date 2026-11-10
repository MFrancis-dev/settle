/**
 * The Settle mark: an amount crossing to the other side and coming to rest on the line.
 * Roadmap: S4.1
 *
 * Drawn for this product, not a letter in a box. The rule is ink (the chrome carries no colour);
 * the descending arrow is the one data hue, so the mark reads as "money, settled".
 */
export function Mark({
  className = "",
  onField = false,
  tone = "brand",
}: {
  className?: string;
  onField?: boolean;
  /** `current` draws the arrow in the surrounding text colour — the night landing's chrome. */
  tone?: "brand" | "current";
}) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden className={className}>
      <path d="M4 17h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M12 4v8.5M12 12.5 8.6 9.1M12 12.5l3.4-3.4"
        stroke={onField || tone === "current" ? "currentColor" : "var(--color-brand)"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
