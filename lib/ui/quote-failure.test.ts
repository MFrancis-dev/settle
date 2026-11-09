import { describe, expect, it } from "vitest";

// Roadmap: S7.4, S7.6, S7.9, S0.13 · the wording a refused quote is answered with.
import { ApiError } from "@/lib/api/client";
import { parseBaseUnits } from "@/lib/core/money";

import { describeQuoteFailure } from "./quote-failure";

/** The invoice's own payout asset, which is what a quote's `amount` — and the exchange's minimum —
 *  is denominated in. Kept to the two fields the wording needs. */
const PAYOUT = { symbol: "USDC", decimals: 6 };

describe("describeQuoteFailure", () => {
  it("tells a client holding the payout asset to settle directly, and does not publish the address (S7.4)", () => {
    const { message, reopen } = describeQuoteFailure(
      new ApiError(409, "same_asset", "This invoice is already in the token you picked.", {
        assetId: "usdc.near",
        symbol: "USDC",
        chain: "near",
      }),
      PAYOUT,
    );

    expect(reopen).toBe(false);
    expect(message).toContain("no conversion for Settle to make");
    expect(message).toContain("Ask the person who sent it for their USDC address");
    expect(message).not.toContain("seller-payout");
  });

  // The number below is the vendor's own refusal, captured live on 2026-11-09 from a
  // BTC→USDC-on-Ethereum quote of 5 USDC: "Amount is too low for bridge, try at least 6232326".
  // 6232326 is 6.232326 USDC — the floor sits on the amount to deliver, in the payout asset, while
  // that same invoice cost 0.00008799 BTC to pay. Reading it with the client's token decimals would
  // have printed 0.06232326 BTC, wrong by ~700× and in an asset the client never receives.
  it("states the exchange's minimum in the invoice's payout asset, not the token being sent (S7.6, S0.13)", () => {
    const { message } = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "1Click rejected this amount as too small.", {
        minimumBaseUnits: parseBaseUnits("6232326"),
      }),
      PAYOUT,
    );

    expect(message).toContain("will not deliver less than 6.232326 USDC");
    expect(message).not.toContain("BTC");
    expect(message).toContain("Nothing was created");
    expect(message).toContain("larger invoice");
  });

  it("still answers when the minimum cannot be made human-readable", () => {
    const withoutPayout = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "too small", { minimumBaseUnits: "1" }),
      null,
    ).message;
    const malformed = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "too small", { minimumBaseUnits: "-3" }),
      PAYOUT,
    ).message;
    const unknownDecimals = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "too small", { minimumBaseUnits: "6232326" }),
      { symbol: "USDC", decimals: null },
    ).message;

    expect(withoutPayout).toContain("an amount this small");
    expect(malformed).toContain("an amount this small");
    expect(unknownDecimals).toContain("an amount this small");
  });

  it("passes the exchange's own wording about a route straight through (S7.9)", () => {
    const { message } = describeQuoteFailure(
      new ApiError(400, "upstream_rejected", "1Click rejected the request.", {
        detail: "no route from nep141:wrap.near to usdc on arbitrum",
      }),
      PAYOUT,
    );

    expect(message).toContain("The exchange refused this route: no route from nep141:wrap.near");
    expect(message).toContain("Pick another token");
  });

  it("says 1Click being down is not a refusal of this payment (S7.9)", () => {
    const { message } = describeQuoteFailure(
      new ApiError(502, "upstream_unreachable", "1Click is not reachable right now."),
      PAYOUT,
    );

    expect(message).toContain("could not be reached");
    expect(message).toContain("Nothing has moved");
    expect(message).not.toContain("refused");
  });

  it("asks for the invoice to be re-read when an address is already open", () => {
    const { message, reopen } = describeQuoteFailure(
      new ApiError(409, "conflict", "A payment address is already open for this invoice.", {
        attemptId: "attempt-1",
      }),
      PAYOUT,
    );

    expect(reopen).toBe(true);
    expect(message).toContain("already open");
  });

  it("falls back to the server's own sentence rather than guessing", () => {
    expect(
      describeQuoteFailure(
        new ApiError(409, "conflict", "This invoice has been cancelled."),
        PAYOUT,
      ).message,
    ).toBe("This invoice has been cancelled.");
    expect(
      describeQuoteFailure(new ApiError(400, "bad_request", "Invalid request body"), PAYOUT)
        .message,
    ).toBe("Invalid request body");
  });

  it("answers a rate limit with how long to wait", () => {
    expect(
      describeQuoteFailure(
        new ApiError(429, "rate_limited", "slow down", { retryAfterS: 12 }),
        PAYOUT,
      ).message,
    ).toContain("12 seconds");
  });

  it("handles something that is not an API error at all", () => {
    expect(describeQuoteFailure(new Error("network went away"), PAYOUT).message).toBe(
      "network went away",
    );
    expect(describeQuoteFailure("nope", PAYOUT).message).toBe("The price could not be prepared.");
  });
});
