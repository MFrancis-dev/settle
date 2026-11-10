/**
 * Buttons.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §2 (hand-rolled Tailwind primitives, not shadcn/ui)
 *
 * `buttonClass` is exported as well as the component, because Next's `<Link>` renders an `<a>` and
 * the two must not drift apart into looking like different controls.
 */

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "invert" | "outline-invert" | "accent" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  // The one primary action is near-black; the chrome carries no brand colour.
  primary: "bg-ink text-ink-invert hover:bg-black border-transparent",
  // A grey pill is the secondary, so the screen keeps a single hue on its data.
  secondary: "bg-control text-ink border-transparent hover:bg-control-strong",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-control hover:text-ink",
  danger: "bg-danger text-ink-invert border-transparent hover:brightness-95",
  // The landing's accent: the one place the chrome takes a hue, because the ground is black.
  accent:
    "bg-accent text-white border-transparent hover:bg-accent-strong shadow-[0_10px_40px_-12px_var(--color-accent)]",
  // A hairline pill for the night ground's second action.
  outline: "bg-transparent text-ink border-line hover:bg-control hover:border-line-strong",
  // On the brand field (the landing's settled-state hero) the chrome inverts: paper is the solid
  // action, a paper outline the secondary. Same roles, read against green instead of stone.
  invert: "bg-surface text-ink border-transparent hover:bg-canvas",
  "outline-invert":
    "bg-transparent text-ink-invert border-ink-invert/40 hover:bg-ink-invert/10 hover:border-ink-invert/70",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-sm px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5 gap-2",
  lg: "text-base px-5 py-3 gap-2",
};

export function buttonClass(
  opts: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; pill?: boolean } = {},
): string {
  const { variant = "primary", size = "md", full = false, pill = false } = opts;
  return [
    "inline-flex items-center justify-center border font-medium",
    "transition-colors duration-150 select-none",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    pill ? "rounded-full" : "rounded-control",
    VARIANTS[variant],
    SIZES[size],
    full ? "w-full" : "",
  ].join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  /** A pill, for the landing's marketing chrome. Product screens keep the crisp control radius. */
  pill?: boolean;
  /** Keeps the label in place and announces the wait, so a double-click cannot double-submit. */
  pending?: boolean;
}

export function Button({
  variant,
  size,
  full,
  pill,
  pending = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClass({ variant, size, full, pill })} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      ) : null}
      {children}
    </button>
  );
}
