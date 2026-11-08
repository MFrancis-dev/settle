/**
 * Form controls with their label, hint and error welded together.
 * Roadmap: S4.2–S4.4 · Spec: PRD FR-4 (typed twice, chain named), WCAG 3.3.1/3.3.2
 *
 * Each control owns its ids, so a screen cannot accidentally ship an input whose error message is
 * not programmatically attached to it. The error text is the server's or the schema's own sentence —
 * these components never reword a validation reason.
 */

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const CONTROL =
  "w-full rounded-control border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint " +
  "border-line-strong focus:border-ink disabled:bg-surface-sunk disabled:text-ink-faint";

const INVALID = "border-danger focus:border-danger";

function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      {hint || error ? (
        <p
          id={`${htmlFor}-message`}
          className={error ? "text-xs text-danger" : "text-xs text-ink-muted"}
          role={error ? "alert" : undefined}
          aria-live={error ? "polite" : undefined}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
  /** Addresses and hashes are fixed-width, so they line up and are readable one at a time. */
  mono?: boolean;
  trailing?: ReactNode;
}

export function TextField({
  label,
  error,
  hint,
  mono,
  required,
  className = "",
  trailing,
  ...rest
}: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {trailing ? (
        <div className="flex items-stretch gap-2">
          <input
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={hint || error ? `${id}-message` : undefined}
            className={`${CONTROL} ${mono ? "font-mono text-xs" : ""} ${error ? INVALID : ""} min-w-0 flex-1`}
            {...rest}
          />
          <div className="flex items-center">{trailing}</div>
        </div>
      ) : (
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-message` : undefined}
          className={`${CONTROL} ${mono ? "font-mono text-xs" : ""} ${error ? INVALID : ""}`}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  required,
  rows = 3,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-message` : undefined}
        className={`${CONTROL} ${error ? INVALID : ""}`}
        {...rest}
      />
    </FieldShell>
  );
}

export interface Choice {
  value: string;
  label: string;
}

export function SelectField({
  label,
  error,
  hint,
  required,
  choices,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  choices: Choice[];
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-message` : undefined}
        className={`${CONTROL} ${error ? INVALID : ""}`}
        {...rest}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** A named checkbox whose state the caller owns, used for the "I understand" gates. */
export function CheckboxField({
  label,
  checked,
  onChange,
  description,
  error,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
