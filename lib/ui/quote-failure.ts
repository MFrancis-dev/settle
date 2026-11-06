/**
 * What a refused quote says to the person who pressed the button.
 * Roadmap: S7.4, S7.6, S7.9 · Spec: PRD §11 (edge cases), ARCHITECTURE.md §11 S-B3, S-B7
 *
 * A refused quote created nothing, so every sentence here has to end in something the client can do.
 * The codes come from `lib/server/http.ts`; the wording lives here, next to `clientMessage`, because
 * only a screen knows what the person in front of it is able to act on.
 *
 * Two rules these sentences obey:
 * - the exchange's own wording about a route is passed through (`details.detail`) rather than
 *   replaced by a guess — it is safe to *answer* with and is never logged (S7.10);
 * - the seller's payout address is never echoed back, not even to explain a refusal, because a pay
 *   link is public (§6).
 */

import { ApiError } from "@/lib/api/client";
import type { TokenOption } from "@/lib/api/types";
import { formatAmount, isBaseUnitsString, parseBaseUnits } from "@/lib/core/money";

export interface QuoteFailure {
  /** The sentence to show. */
  message: string;
  /** True when the refusal means an address is already open, so the invoice must be re-read. */
  reopen: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function describeQuoteFailure(error: unknown, token: TokenOption | null): QuoteFailure {
  const shown: QuoteFailure = { message: "", reopen: false };

  if (!(error instanceof ApiError)) {
    shown.message = error instanceof Error ? error.message : "The price could not be prepared.";
    return shown;
  }

  const details = isRecord(error.details) ? error.details : null;

  switch (error.code) {
    case "rate_limited":
      shown.message = `Too many price requests from here. Try again in ${error.retryAfterS ?? 60} seconds.`;
      return shown;

    case "conflict":
      if (details !== null && "attemptId" in details) {
        shown.reopen = true;
        shown.message =
          "A payment address for this invoice is already open. Use that one — paying twice would only send the extra back to you.";
        return shown;
      }
      break;

    // S7.4: the client already holds the asset this invoice pays out in, so there is no conversion
    // to price. The address is not published from a public link; the client is told to ask for it.
    case "same_asset": {
      const symbol = typeof details?.symbol === "string" ? details.symbol : "that token";
      shown.message = `This invoice is paid out in ${symbol}, which is the token you picked, so there is no conversion for Settle to make and no price to show. Ask the person who sent it for their ${symbol} address and send the invoiced amount there directly — they can then mark the invoice paid.`;
      return shown;
    }

    // S7.6: the exchange's own minimum, in the token the client would have sent.
    case "amount_too_low": {
      const minimum = details?.minimumBaseUnits;
      const smallest =
        typeof minimum === "string" && isBaseUnitsString(minimum) && token
          ? `${formatAmount(parseBaseUnits(minimum), token.decimals)} ${token.symbol}`
          : null;
      shown.message = smallest
        ? `The exchange will not convert less than ${smallest} on this route, and this invoice works out to less than that. Nothing was created. Ask the seller for a larger invoice, or pick a token whose minimum this total clears.`
        : "The exchange will not convert an amount this small on this route. Nothing was created. Ask the seller for a larger invoice, or pick another token.";
      return shown;
    }

    // S7.9: 1Click being down is not a refusal of this payment, and must not read as one.
    case "upstream_unreachable":
      shown.message =
        "The exchange could not be reached, so no price was prepared and no address was created. Nothing has moved — try again in a minute.";
      return shown;

    // S7.9: a route that does not exist and a region the exchange does not serve both arrive as the
    // exchange's own sentence about the request we sent.
    case "upstream_rejected": {
      const detail =
        typeof details?.detail === "string" && details.detail.trim() !== "" ? details.detail.trim() : null;
      shown.message = `${
        detail ? `The exchange refused this route: ${detail}. ` : "The exchange refused this route. "
      }Nothing was created. Pick another token, or ask the seller to invoice in an asset you already hold.`;
      return shown;
    }

    default:
      break;
  }

  shown.message = error.message;
  return shown;
}
