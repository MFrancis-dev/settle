"use client";

/**
 * Every payout address this account has ever used, newest first.
 * Roadmap: S4.2 · Spec: ARCHITECTURE.md §6 (the previous row is kept, so the log is the table)
 *
 * A hijacked session that changes the address leaves proof here, which is the point of keeping the
 * old rows: the person checking can see *when* it moved, not just where it is now.
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePayoutLog } from "@/lib/api/queries";
import { chainLabel } from "@/lib/ui/chain";
import { dateTimeText } from "@/lib/ui/date-text";

export function PayoutChangeLog() {
  const log = usePayoutLog();

  return (
    <Card
      title="Address change log"
      description="Each entry is a change your own wallet signed. Changing it again adds a row; nothing is overwritten."
    >
      {log.isPending ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : log.isError ? (
        <p className="text-sm text-danger">
          {log.error instanceof Error ? log.error.message : "The log could not be read."}
        </p>
      ) : log.data.length === 0 ? (
        <p className="text-sm text-ink-muted">No address has been saved yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {log.data.map((entry, index) => (
            <li
              key={index}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {entry.assetSymbol ?? entry.assetId} on {chainLabel(entry.chain)}
                </p>
                <p className="mt-0.5 break-all font-mono text-xs">{entry.address}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {entry.active ? "In use since" : "Used until"} {dateTimeText(entry.since)}
                  {entry.deactivatedAt ? ` — ${dateTimeText(entry.deactivatedAt)}` : ""}
                </p>
              </div>
              {entry.active ? <Badge tone="success">Active</Badge> : <Badge>Replaced</Badge>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
