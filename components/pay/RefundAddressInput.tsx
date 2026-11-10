"use client";

/**
 * The refund address: where money goes back to if the deposit is short, over, or never converts.
 * Roadmap: S4.4 · Spec: PRD FR-13, ARCHITECTURE.md §6
 *
 * Validated as it is typed against the *origin* chain — the same validator the server runs — because
 * this is the address that saves the client's money, and a typo here is the one mistake a pay page
 * cannot undo later. The error only appears once they have typed something, so a blank first screen
 * is not red.
 */

import { TextField } from "@/components/ui/field";
import { validateRefundAddress, type AddressValidation } from "@/lib/core/address";
import { addressHint, chainLabel } from "@/lib/ui/chain";

function reason(checked: AddressValidation): string | null {
  return checked.valid ? null : checked.reason;
}

export function RefundAddressInput({
  chain,
  value,
  onChange,
  onSubmitAttempt,
}: {
  chain: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Fired on Enter, so the keyboard path to "show the price" works from this field. */
  onSubmitAttempt?: () => void;
}) {
  const trimmed = value.trim();
  // A three-character string is somebody mid-typing, not an address worth calling wrong.
  const problem =
    chain !== null && trimmed.length > 3 ? reason(validateRefundAddress(chain, trimmed)) : null;

  return (
    <TextField
      label="Address to refund to"
      required
      mono
      value={value}
      hint={
        chain
          ? `Your own ${chainLabel(chain)} address, in case the payment comes back. ${addressHint(chain)}`
          : "Choose the token first — the refund goes back on that network."
      }
      error={problem ?? undefined}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onSubmitAttempt) {
          event.preventDefault();
          onSubmitAttempt();
        }
      }}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
