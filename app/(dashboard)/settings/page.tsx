"use client";

/**
 * Settings: the account, the payout destination, and the record of its changes.
 * Roadmap: S4.2 · Spec: PRD FR-3, FR-4, FR-6
 *
 * The account block is read-only: the account id is what the wallet signed, and the name is the one
 * Settle took from it. There is no profile-write endpoint, so this screen shows the truth rather than
 * fields that would not save.
 */

import { Card, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PayoutForm } from "@/components/payout/PayoutForm";
import { PayoutChangeLog } from "@/components/payout/PayoutChangeLog";
import { useMe } from "@/lib/api/queries";
import { dateTimeText } from "@/lib/ui/date-text";

export default function Page() {
  const me = useMe();

  if (me.isPending) return <p className="text-sm text-ink-muted">Loading settings…</p>;
  if (!me.data) return null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Account">
        <DefinitionList
          items={[
            {
              label: "Signed in as",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs">{me.data.nearAccountId}</span>
                  {me.data.isDemo ? <Badge tone="warn">Demo account</Badge> : null}
                </span>
              ),
            },
            { label: "Name on invoices", value: me.data.displayName },
            { label: "Reminder email", value: me.data.email ?? "Not set" },
          ]}
        />
        <p className="mt-3 text-xs text-ink-faint">
          Signing in proves you control this account; it does not give Settle permission to move funds.
          {me.data.payout ? ` Payout address saved ${dateTimeText(me.data.payout.since)}.` : ""}
        </p>
      </Card>

      <PayoutForm current={me.data.payout} />
      <PayoutChangeLog />
    </div>
  );
}
