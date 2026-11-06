"use client";

/**
 * The client's pay page — the one screen a person sees who has no Settle account and never gets one.
 * Roadmap: S4.4, S4.5 · Spec: PRD FR-11..FR-17, ARCHITECTURE.md §3.2, §6
 *
 * Three rules the layout enforces:
 * 1. Opening this page creates nothing. The invoice is read; a quote is only taken when the client
 *    presses a button, and the first button is the free preview (`dry: true`), which stores nothing.
 * 2. The price is shown before the address. The client sees what they send, what the seller receives,
 *    the fee and the expiry, and only then is a deposit address made.
 * 3. One live address at a time. If the server says another quote is already open, this screen goes
 *    back to showing that one rather than starting a second — two live quotes is how a client pays
 *    twice.
 * 4. In demo mode the page says so at the top and swaps the transaction-reference field for the
 *    simulate panel (§7): a payment that was never sent must never look like one that was.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, DefinitionList } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { Countdown } from "@/components/pay/Countdown";
import { DemoSimulate } from "@/components/pay/DemoSimulate";
import { DepositPanel } from "@/components/pay/DepositPanel";
import { PayStatus } from "@/components/pay/PayStatus";
import { RefundAddressInput } from "@/components/pay/RefundAddressInput";
import { ShortPaymentWarning } from "@/components/pay/ShortPaymentWarning";
import { TokenPicker } from "@/components/pay/TokenPicker";
import { StatusBadge } from "@/components/invoice/StatusBadge";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { ApiError } from "@/lib/api/client";
import {
  usePaymentStatus,
  usePublicInvoice,
  useQuote,
  useSubmitTx,
  useTokens,
} from "@/lib/api/queries";
import type { AttemptView, QuoteView, StatusView } from "@/lib/api/types";
import type { InvoiceStatus } from "@/lib/core/status";
import { describeQuoteFailure } from "@/lib/ui/quote-failure";
import { dateText } from "@/lib/ui/date-text";
import { usdText } from "@/lib/ui/money-text";

/** Statuses where paying is still possible; the rest are records, not invitations. */
const PAYABLE: readonly InvoiceStatus[] = ["open", "payment_detected", "processing", "underpaid"];

/** Settled states still owe the client a receipt, which only the status read carries. */
const SETTLED: readonly InvoiceStatus[] = ["paid", "overpaid", "paid_after_cancel"];

export default function Page() {
  const { publicId } = useParams<{ publicId: string }>();
  const invoice = usePublicInvoice(publicId);
  const tokens = useTokens();
  const quote = useQuote(publicId);
  const submitTx = useSubmitTx(publicId);

  const [originAsset, setOriginAsset] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [preview, setPreview] = useState<QuoteView | null>(null);
  const [address, setAddress] = useState<QuoteView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const chosen = useMemo(
    () => tokens.data?.assets.find((asset) => asset.assetId === originAsset) ?? null,
    [tokens.data, originAsset],
  );

  const attempt: AttemptView | null = address?.attempt ?? invoice.data?.activeAttempt ?? null;
  const settled = invoice.data ? SETTLED.includes(invoice.data.status) : false;
  const status = usePaymentStatus(publicId, attempt !== null || settled);
  const live = status.data;

  async function askPreview() {
    setFailure(null);
    try {
      setPreview(await quote.mutateAsync({ originAsset, refundTo: refundTo.trim(), dry: true }));
    } catch (error) {
      setPreview(null);
      refused(error);
    }
  }

  async function askAddress() {
    setFailure(null);
    try {
      const result = await quote.mutateAsync({
        originAsset,
        refundTo: refundTo.trim(),
        dry: false,
      });
      setAddress(result);
      setPreview(null);
      if (result.reused) void invoice.refetch();
    } catch (error) {
      refused(error);
    }
  }

  /** One place turns a refusal into words, so both buttons answer the same way. */
  function refused(error: unknown) {
    const failure = describeQuoteFailure(error, chosen);
    if (failure.reopen) void invoice.refetch();
    setFailure(failure.message);
  }

  if (invoice.isPending) {
    return (
      <main id="main" className="mx-auto w-full max-w-lg px-5 py-10">
        <p className="text-sm text-ink-muted">Loading invoice…</p>
      </main>
    );
  }

  if (invoice.isError || !invoice.data) {
    return (
      <main id="main" className="mx-auto w-full max-w-lg px-5 py-10">
        <Alert tone="danger" title="This payment link does not open an invoice">
          <p>{invoice.error instanceof Error ? invoice.error.message : "Unknown error."}</p>
          <p className="mt-2 text-ink-muted">
            Ask the person who sent it to check the link, or send you a new one.
          </p>
        </Alert>
      </main>
    );
  }

  const view = invoice.data;
  const payable = PAYABLE.includes(view.status);

  return (
    <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 py-8 pb-16">
      <header>
        <p className="text-sm text-ink-muted">{view.seller} sent you an invoice</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {view.total ? <Money money={view.total} /> : "Invoice"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {view.number} · for {view.clientName}
          {view.dueDate ? ` · due ${dateText(view.dueDate)}` : ""}
        </p>
        <div className="mt-2">
          <StatusBadge status={view.status} />
        </div>
      </header>

      {view.demo ? <DemoBanner /> : null}

      {!payable && !settled ? (
        <Alert tone="neutral" title="This invoice is not open for payment">
          <p>
            {view.status === "cancelled"
              ? "The person who sent it cancelled this invoice, so nothing is owed. A payment that arrived anyway is reported to them and returned to your refund address."
              : "This invoice has not been sent yet, so there is nothing to pay."}
          </p>
        </Alert>
      ) : null}

      {view.memo ? (
        <Card title="Note from the seller">
          <p className="whitespace-pre-line text-sm">{view.memo}</p>
        </Card>
      ) : null}

      {attempt ? (
        <DepositPanel
          deposit={attempt.originAsset}
          feeUsd={attempt.feeUsd}
          timeEstimateS={address?.timeEstimateS ?? null}
          deadline={attempt.quoteDeadline}
          address={attempt.depositAddress}
          memo={attempt.depositMemo}
          reused={address === null}
          onExpire={() => {
            setAddress(null);
            void invoice.refetch();
          }}
        />
      ) : payable ? (
        <Card title="Choose how you want to pay">
          {tokens.isPending ? (
            <p className="text-sm text-ink-muted">Loading the list of tokens…</p>
          ) : tokens.isError ? (
            <Alert tone="warn" title="The token list could not be read">
              <p>{tokens.error instanceof Error ? tokens.error.message : "Unknown error."}</p>
              <p className="mt-1">Try again in a minute.</p>
            </Alert>
          ) : (
            <div className="flex flex-col gap-5">
              <TokenPicker
                tokens={tokens.data.assets}
                value={originAsset}
                onChange={setOriginAsset}
              />
              <RefundAddressInput
                chain={chosen?.settleChain ?? null}
                value={refundTo}
                onChange={setRefundTo}
                onSubmitAttempt={askPreview}
              />

              {preview ? <QuotePreview quote={preview} /> : null}
              {failure ? (
                <Alert tone="danger" title="Nothing was created">
                  <p>{failure}</p>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2">
                <Button
                  variant={preview ? "secondary" : "primary"}
                  size="lg"
                  full
                  pending={quote.isPending && preview === null}
                  disabled={originAsset === "" || refundTo.trim() === ""}
                  onClick={askPreview}
                >
                  Show me the price
                </Button>
                {preview ? (
                  <Button
                    size="lg"
                    full
                    pending={quote.isPending && preview !== null}
                    onClick={askAddress}
                  >
                    Get a payment address
                  </Button>
                ) : null}
                <p className="text-xs text-ink-faint">
                  Showing the price starts no payment and creates no address. Settle holds it for a
                  few minutes, then re-quotes — it never charges an old price.
                </p>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {attempt ? <ShortPaymentWarning deposit={attempt.originAsset} /> : null}

      {live || attempt ? (
        <PayStatus
          status={live ?? emptyStatus(view.status, attempt)}
          actions={
            attempt ? (
              view.demo ? (
                <DemoSimulate publicId={publicId} />
              ) : (
                <ReportPayment
                  onSubmit={async (txHash) => {
                    try {
                      const result = await submitTx.mutateAsync(txHash);
                      return result.forwarded
                        ? "We have asked the service to look for it now. Keep this page open."
                        : "The service could not be reached just now. Your payment is still on its way, and this page keeps checking.";
                    } catch (error) {
                      return error instanceof ApiError
                        ? error.message
                        : "That reference could not be sent. Keep this page open instead — it checks on its own.";
                    }
                  }}
                />
              )
            ) : null
          }
        />
      ) : null}

      <footer className="text-xs text-ink-faint">
        <DefinitionList
          items={[
            { label: "Seller", value: view.seller },
            { label: "Invoice", value: view.number },
            { label: "Issued", value: dateText(view.issuedAt) },
          ]}
        />
        <p className="mt-3">
          Settle converts your payment through 1Click Payment, and every step is a transaction you
          can look up on the receipt. Settle itself is never given permission to spend from your
          wallet.
        </p>
      </footer>
    </main>
  );
}

/** The price before an address exists: what leaves the wallet, what the seller gets, the fee. */
function QuotePreview({ quote }: { quote: QuoteView }) {
  const fee = usdText(quote.feeUsd);
  return (
    <div className="rounded-card border border-brand/30 bg-brand-soft p-4">
      <h2 className="text-sm font-semibold text-brand">This is what the payment would be</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-faint">You send</dt>
          <dd className="mt-0.5 font-medium">
            <Money money={quote.deposit} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Seller receives</dt>
          <dd className="mt-0.5">
            <Money money={quote.payout} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Conversion fee</dt>
          <dd className="mt-0.5">{fee ?? "Included in the amount above"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Takes</dt>
          <dd className="mt-0.5">
            {quote.timeEstimateS === null
              ? "A few minutes"
              : `About ${Math.max(1, Math.round(quote.timeEstimateS / 60))} min`}
          </dd>
        </div>
      </dl>
      <p className="mt-3 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
        This price holds for <Countdown deadline={quote.deadline} /> — after that it is re-quoted,
        never charged.
      </p>
    </div>
  );
}

/** Optional, and only an optimisation: telling the service the deposit exists ahead of its own scan. */
function ReportPayment({ onSubmit }: { onSubmit: (txHash: string) => Promise<string> }) {
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-sm font-medium">Already sent it?</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Pasting your transaction reference makes the check start now instead of on the next scan.
        Nothing changes if you skip it.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <TextField
          className="min-w-0 flex-1 basis-48"
          label="Transaction reference"
          mono
          value={txHash}
          onChange={(event) => setTxHash(event.target.value)}
          placeholder="The hash your wallet shows after sending"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          variant="secondary"
          disabled={txHash.trim() === "" || busy}
          pending={busy}
          onClick={async () => {
            setBusy(true);
            setMessage(await onSubmit(txHash.trim()));
            setBusy(false);
            setTxHash("");
          }}
        >
          Tell Settle
        </Button>
      </div>
      {message ? (
        <p className="mt-2 text-sm text-ink-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Before the first poll lands there is nothing fresh to say, so this reports the invoice status with
 * `polled: false` and no reason — "we have not checked yet", never "it is not paid".
 */
function emptyStatus(invoiceStatus: InvoiceStatus, attempt: AttemptView | null): StatusView {
  return {
    invoiceStatus,
    attempt,
    // Nothing has been polled yet, so there is no second payment to report either; the first poll
    // replaces this whole object, `otherPayments` included.
    otherPayments: [],
    polled: false,
    pollReason: attempt === null ? "no_attempt" : null,
    paid: false,
    receiptUrl: null,
  };
}
