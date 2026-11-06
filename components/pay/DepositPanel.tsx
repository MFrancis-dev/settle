"use client";

/**
 * The address the client pays into — the screen the whole product exists for.
 * Roadmap: S4.4 · Spec: PRD FR-14, FR-15, FR-16
 *
 * Four things have to be unmissable here: the exact amount, the address, the network it belongs to,
 * and how long the price lasts. The QR is the copy-free path on a phone, and the memo is shown apart
 * from the address because some networks need it and a pasted pair would break the other ones.
 */

import { QRCodeSVG } from "qrcode.react";

import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Countdown } from "./Countdown";
import { Money, MoneyExact } from "@/components/ui/money";
import type { MoneyView } from "@/lib/api/types";
import { usdText } from "@/lib/ui/money-text";

export function DepositPanel({
  deposit,
  feeUsd,
  timeEstimateS,
  deadline,
  address,
  memo,
  reused,
  onExpire,
}: {
  deposit: MoneyView;
  feeUsd: string | null;
  timeEstimateS: number | null;
  deadline: string;
  address: string;
  memo: string | null;
  /** True when this is the same address as before, so the client knows nothing changed. */
  reused: boolean;
  onExpire: () => void;
}) {
  const fee = usdText(feeUsd);

  return (
    <Card
      title="Send this amount"
      description={reused ? "This is the same address as before — the amount has not changed." : "One payment, from your own wallet."}
      actions={<Countdown deadline={deadline} onExpire={onExpire} />}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="shrink-0 self-center rounded-card border border-line bg-surface p-3 sm:self-start">
          <QRCodeSVG value={address} size={168} level="M" aria-hidden />
          <p className="mt-2 max-w-[10rem] text-center text-xs text-ink-faint">
            Scan with your wallet, or copy the address.
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold">
            <Money money={deposit} />
          </p>
          <MoneyExact money={deposit} />

          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-faint">Payment address</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 basis-full break-all rounded-control border border-line bg-surface-sunk px-3 py-2 font-mono text-xs sm:basis-0">
                  {address}
                </span>
                <CopyButton value={address} label="Copy address" />
              </dd>
            </div>

            {memo ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Memo / tag</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-control border border-line bg-surface-sunk px-3 py-2 font-mono text-xs">
                    {memo}
                  </span>
                  <CopyButton value={memo} label="Copy memo" />
                </dd>
                <p className="mt-1 text-xs text-warn" role="alert">
                  Your wallet must include this memo, or the payment cannot be matched to your invoice.
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Conversion fee</dt>
                <dd className="mt-0.5">{fee ?? "Not quoted"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">How long</dt>
                <dd className="mt-0.5">{timeEstimateS === null ? "A few minutes" : `About ${Math.max(1, Math.round(timeEstimateS / 60))} min`}</dd>
              </div>
            </div>
          </dl>

          <ul className="mt-4 flex flex-col gap-1 text-xs text-ink-muted">
            <li>Send the full amount in one payment.</li>
            <li>
              Send {deposit.symbol ?? "the token you chose"} to this address — another asset sent here cannot
              be matched to your invoice.
            </li>
            <li>Nothing else needs to be sent to anyone. This address is the whole payment.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}
