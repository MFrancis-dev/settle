"use client";

/**
 * Set or change where the freelancer is paid.
 * Roadmap: S4.2 · Spec: PRD FR-4 (typed twice, chain named), FR-6 (a fresh signature per change),
 * ARCHITECTURE.md §6
 *
 * This is the one form in Settle that can move money to a stranger, so nothing is taken on trust:
 * the address is typed twice, checked by the same validator the server uses, named by chain, and the
 * wallet signs a message that quotes that exact address. The signature is made at submit time, never
 * cached, because a signature for one address must not be able to authorise another.
 */

import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { useSetPayout, useTokens } from "@/lib/api/queries";
import { ApiError } from "@/lib/api/client";
import type { PayoutView, StorageView } from "@/lib/api/types";
import { useWallet, WalletCancelled } from "@/components/wallet/WalletProvider";
import { payoutMessage } from "@/lib/core/payout-message";
import { validateAddress } from "@/lib/core/address";
import { addressHint, chainLabel } from "@/lib/ui/chain";
import { dateTimeText } from "@/lib/ui/date-text";

export function PayoutForm({ current }: { current: PayoutView | null }) {
  const tokens = useTokens();
  const setPayout = useSetPayout();
  const { signPayoutChange } = useWallet();

  const [assetId, setAssetId] = useState(current?.assetId ?? "");
  const [address, setAddress] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ address?: string; addressConfirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{
    payout: PayoutView;
    storage: StorageView | null;
    openQuotes: number;
  } | null>(null);

  const payoutAssets = useMemo(() => tokens.data?.payoutAssets ?? [], [tokens.data]);
  const chosen = useMemo(
    () => payoutAssets.find((asset) => asset.assetId === assetId) ?? null,
    [payoutAssets, assetId],
  );
  const chain = chosen?.settleChain ?? null;

  const options = useMemo(
    () =>
      payoutAssets.map((asset) => ({
        value: asset.assetId,
        label: asset.settleChain
          ? `${asset.symbol} · ${chainLabel(asset.settleChain)}`
          : asset.symbol,
      })),
    [payoutAssets],
  );

  async function submit() {
    setFieldErrors({});
    setFailure(null);
    setResult(null);

    if (!chosen || chain === null) {
      setFailure("Choose an asset first — Settle needs to know which network the address is on.");
      return;
    }
    const errors: typeof fieldErrors = {};
    const checked = validateAddress(chain, address.trim());
    if (!checked.valid) errors.address = checked.reason;
    if (address.trim() !== confirm.trim()) errors.addressConfirm = "The two addresses must match.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const destination = { assetId: chosen.assetId, chain, address: address.trim() };
    try {
      // Signed here, at submit, over this exact address.
      const body = await signPayoutChange(destination);
      const change = await setPayout.mutateAsync(body);
      setResult({ payout: change.payout, storage: change.storage, openQuotes: change.openQuotes });
      setAddress("");
      setConfirm("");
    } catch (error) {
      if (error instanceof WalletCancelled) return;
      setFailure(describe(error));
    }
  }

  return (
    <Card
      title="Where you get paid"
      description={
        current
          ? `Currently ${current.assetSymbol ?? current.assetId} on ${chainLabel(current.chain)} — ${mask(current.address)}, since ${dateTimeText(current.since)}.`
          : "Choose the asset and address that settled invoices are sent to."
      }
    >
      {tokens.isPending ? (
        <p className="text-sm text-ink-muted">Loading the list of assets…</p>
      ) : tokens.isError ? (
        <Alert tone="warn" title="The asset list could not be read">
          {tokens.error instanceof Error ? tokens.error.message : "Unknown error."} Try again in a
          minute.
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Asset you want to be paid in"
              required
              choices={[{ value: "", label: "Choose an asset" }, ...options]}
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            />
            <TextField
              label="Network"
              value={chain ? chainLabel(chain) : ""}
              readOnly
              placeholder="Set by the asset"
              hint="Each asset arrives on one network; Settle checks your address against that network's rules."
            />
          </div>

          {chosen && chosen.settleChain === null ? (
            <Alert tone="warn" title="Settle cannot check this network yet">
              You can still save the address, but a typo cannot be caught before it is used. Copy it
              from your wallet rather than typing it.
            </Alert>
          ) : null}

          <TextField
            label="Payout address"
            required
            mono
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            error={fieldErrors.address}
            hint={chain ? addressHint(chain) : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            label="Type the address again"
            required
            mono
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={fieldErrors.addressConfirm}
            hint="Twice, because a wrong address takes the money permanently."
            autoComplete="off"
            spellCheck={false}
          />

          {address.trim() !== "" && address.trim() === confirm.trim() && chain ? (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Your wallet will be asked to sign:{" "}
              <span className="font-mono">{payoutMessage(chain, address.trim())}</span>
            </p>
          ) : null}

          {failure ? (
            <Alert tone="danger" title="The address was not saved">
              {failure}
            </Alert>
          ) : null}

          {result ? <Saved change={result} previous={current} /> : null}

          <div>
            <Button
              type="submit"
              size="lg"
              pending={setPayout.isPending}
              disabled={assetId === "" || address === "" || confirm === ""}
            >
              {current ? "Sign and change payout address" : "Sign and save payout address"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Saved({
  change,
  previous,
}: {
  change: { payout: PayoutView; storage: StorageView | null; openQuotes: number };
  previous: PayoutView | null;
}) {
  const { payout, storage, openQuotes } = change;
  const same =
    previous !== null && previous.address === payout.address && previous.assetId === payout.assetId;
  return (
    <Alert
      tone={storage && storage.checked && storage.registered === false ? "warn" : "success"}
      title={same ? "Nothing changed" : "Payout address saved"}
    >
      <p>
        {same
          ? "That is the address already on your account, so no new entry was added to the change log."
          : `Invoices now settle to ${payout.assetSymbol ?? payout.assetId} on ${chainLabel(payout.chain)} — ${mask(payout.address)}.`}
      </p>
      {!same && openQuotes > 0 ? (
        <p>
          {openQuotes === 1 ? "One payment address is" : `${openQuotes} payment addresses are`}{" "}
          still open and still pay the {previous ? mask(previous.address) : "previous"} address. A
          change never moves a quote that was already given — if you want that money to come here
          instead, cancel the invoice and send a new link.
        </p>
      ) : null}
      {storage === null ? null : <p>{storageNote(storage)}</p>}
    </Alert>
  );
}

/**
 * The USDC storage check, in plain words. `checked: false` means the check could not run — that is
 * never reported as "fine", because a missing answer is not a passed one.
 */
function storageNote(storage: StorageView): string {
  if (!storage.checked) {
    return `The USDC storage check could not run (${storage.reason ?? "unknown reason"}), so it is not known whether a transfer to this account would be accepted.`;
  }
  if (storage.registered === false) {
    return `This USDC account is not registered with ${storage.contract ?? "the token contract"}, so a transfer may be refused until it is (the contract charges ${
      storage.minimumBaseUnits ?? "an unknown amount"
    } yoctoNEAR). Settle only reports that — it does not spend from the payer account.`;
  }
  return "That USDC account is registered, so incoming transfers will land.";
}

/** A wrong address must be re-read, not re-guessable from a truncated echo. */
function mask(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * The server's rejection reasons, in the language of what the person can do next. These are the
 * `SignatureRejection` union (`lib/near/nep413.ts` on the API branch); an unknown one falls back to
 * the server's own sentence rather than a wrong guess.
 */
const REASONS: Record<string, string> = {
  replayed: "That signature was already used. Sign a new one.",
  message_mismatch: "The message your wallet signed does not quote this address exactly.",
  signature_mismatch:
    "The key that signed is not one of your account's keys, or the signature is corrupt.",
  bad_public_key: "Your wallet sent a public key Settle cannot read.",
  bad_signature_encoding: "Your wallet sent a signature Settle cannot read.",
  recipient_mismatch: "That signature was made for a different site, not this one.",
  nonce_mismatch: "That signature does not match the request. Try again.",
  nonce_too_short: "Your wallet signed a value too short to be a nonce. Try again.",
  malformed_payload: "Your wallet sent a message Settle could not parse.",
  stale: "That signature is too old. Sign a new one.",
};

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = error.signatureReason;
    return (reason ? REASONS[reason] : undefined) ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
