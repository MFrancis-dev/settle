import { describe, expect, it } from "vitest";

// Roadmap: S7.4, S7.6, S7.9 · the wording a refused quote is answered with.
import { ApiError } from "@/lib/api/client";
import type { TokenOption } from "@/lib/api/types";
import { parseBaseUnits } from "@/lib/core/money";

import { describeQuoteFailure } from "./quote-failure";

const WNEAR: TokenOption = {
  assetId: "nep141:wrap.near",
  symbol: "wNEAR",
  blockchain: "near",
  decimals: 24,
  refundSupported: true,
  settleChain: "near",
};

describe("describeQuoteFailure", () => {
  it("tells a client holding the payout asset to settle directly, and does not publish the address (S7.4)", () => {
    const { message, reopen } = describeQuoteFailure(
      new ApiError(409, "same_asset", "This invoice is already in the token you picked.", {
        assetId: "usdc.near",
        symbol: "USDC",
        chain: "near",
      }),
      WNEAR,
    );

    expect(reopen).toBe(false);
    expect(message).toContain("no conversion for Settle to make");
    expect(message).toContain("Ask the person who sent it for their USDC address");
    expect(message).not.toContain("seller-payout");
  });

  it("states the exchange's minimum in the token the client would have sent (S7.6)", () => {
    const { message } = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "1Click rejected this amount as too small.", {
        minimumBaseUnits: parseBaseUnits("1000000000000000000000000"),
      }),
      WNEAR,
    );

    expect(message).toContain("will not convert less than 1 wNEAR");
    expect(message).toContain("Nothing was created");
  });

  it("still answers when the minimum cannot be made human-readable", () => {
    const withoutToken = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "too small", { minimumBaseUnits: "1" }),
      null,
    ).message;
    const malformed = describeQuoteFailure(
      new ApiError(400, "amount_too_low", "too small", { minimumBaseUnits: "-3" }),
      WNEAR,
    ).message;

    expect(withoutToken).toContain("an amount this small");
    expect(malformed).toContain("an amount this small");
  });

  it("passes the exchange's own wording about a route straight through (S7.9)", () => {
    const { message } = describeQuoteFailure(
      new ApiError(400, "upstream_rejected", "1Click rejected the request.", {
        detail: "no route from nep141:wrap.near to usdc on arbitrum",
      }),
      WNEAR,
    );

    expect(message).toContain("The exchange refused this route: no route from nep141:wrap.near");
    expect(message).toContain("Pick another token");
  });

  it("says 1Click being down is not a refusal of this payment (S7.9)", () => {
    const { message } = describeQuoteFailure(
      new ApiError(502, "upstream_unreachable", "1Click is not reachable right now."),
      WNEAR,
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
      WNEAR,
    );

    expect(reopen).toBe(true);
    expect(message).toContain("already open");
  });

  it("falls back to the server's own sentence rather than guessing", () => {
    expect(describeQuoteFailure(new ApiError(409, "conflict", "This invoice has been cancelled."), WNEAR).message).toBe(
      "This invoice has been cancelled.",
    );
    expect(describeQuoteFailure(new ApiError(400, "bad_request", "Invalid request body"), WNEAR).message).toBe(
      "Invalid request body",
    );
  });

  it("answers a rate limit with how long to wait", () => {
    expect(describeQuoteFailure(new ApiError(429, "rate_limited", "slow down", { retryAfterS: 12 }), WNEAR).message).toContain(
      "12 seconds",
    );
  });

  it("handles something that is not an API error at all", () => {
    expect(describeQuoteFailure(new Error("network went away"), WNEAR).message).toBe("network went away");
    expect(describeQuoteFailure("nope", WNEAR).message).toBe("The price could not be prepared.");
  });
});
