/**
 * Buttons.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §2 (hand-rolled Tailwind primitives, not shadcn/ui)
 *
 * `buttonClass` is exported as well as the component, because Next's `<Link>` renders an `<a>` and
 * the two must not drift apart into looking like different controls.
 */

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  // The one primary action is near-black; the chrome carries no brand colour.
  primary: "bg-ink text-ink-invert hover:bg-black border-transparent",
  // A grey pill is the secondary, so the screen keeps a single hue on its data.
  secondary: "bg-control text-ink border-transparent hover:bg-control-strong",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-control hover:text-ink",
  danger: "bg-danger text-ink-invert border-transparent hover:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-sm px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5 gap-2",
  lg: "text-base px-5 py-3 gap-2",
};

export function buttonClass(
  opts: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean } = {},
): string {
  const { variant = "primary", size = "md", full = false } = opts;
  return [
    "inline-flex items-center justify-center rounded-control border font-medium",
    "transition-colors duration-150 select-none",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    full ? "w-full" : "",
  ].join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  /** Keeps the label in place and announces the wait, so a double-click cannot double-submit. */
  pending?: boolean;
}

export function Button({
  variant,
  size,
  full,
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
      className={`${buttonClass({ variant, size, full })} ${className}`}
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
