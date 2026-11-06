/**
 * A titled panel: the card every screen is built out of.
 * Roadmap: S4.1
 */

import type { ReactNode } from "react";

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  as: Tag = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={`rounded-card border border-line bg-surface shadow-card ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </Tag>
  );
}

/** A row of label/value pairs — used for invoice, payout and receipt detail. */
export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col">
          <dt className="text-xs uppercase tracking-wide text-ink-faint">{item.label}</dt>
          <dd className="min-w-0 text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
