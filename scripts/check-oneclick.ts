/**
 * Prove an `ONECLICK_JWT` works, without moving funds.
 * Roadmap: S8.7 · Spec: ARCHITECTURE.md §11 (S8.4 credential note)
 *
 * Usage:
 *   set -a; . ./.env.local; set +a
 *   pnpm oneclick:check                # a dry preview: proves the token is accepted
 *   pnpm oneclick:check --real <addr>  # a non-dry quote: proves a deposit address is issued
 *
 * A dry quote answers 200 even with no token, so it only rules out a *wrong* one (1Click answers
 * 401 `Invalid token`). The deposit address is the part a real payment needs, and 1Click returns
 * it only to a partner credential — without one the same request answers 400 "Internal server
 * error". `--real` asks for that address once, for 10.5 USDC on NEAR quoted into itself; nothing
 * is deposited, no invoice is touched, and the quote expires on its own.
 */

import { validateAddress } from "../lib/core/address";
import { toBaseUnits } from "../lib/core/money";
import { OneClickError, createOneClickClient } from "../lib/oneclick/client";
import { requestInvoiceQuote, type InvoiceQuoteParams } from "../lib/oneclick/quote";
import { createTokenRegistry } from "../lib/oneclick/tokens";
import { parseEnv } from "../lib/server/env-schema";

const USDC_NEAR = "USDC on near";
const CHECK_ADDRESS = "settle-check.near";

function usage(): void {
  console.error("usage: pnpm oneclick:check [--real <near-account>]");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const realIndex = args.indexOf("--real");
  const realRecipient = realIndex === -1 ? null : (args[realIndex + 1] ?? null);
  if (realIndex !== -1 && realRecipient === null) {
    usage();
    return 2;
  }
  if (realRecipient !== null) {
    const checked = validateAddress("NEAR", realRecipient);
    if (!checked.valid) {
      console.error(`--real needs a NEAR account id: ${checked.reason}`);
      return 2;
    }
  }

  const env = parseEnv();
  console.log("oneclick:check — 1Click partner credential");
  console.log(`  base:  ${env.ONECLICK_BASE_URL}`);
  console.log(`  token: ${env.ONECLICK_JWT ? "set (not printed)" : "NOT SET"}`);
  if (!env.ONECLICK_JWT) {
    console.log("  a token comes from https://partners.near-intents.org (Partner Dashboard).");
    console.log(
      "Verdict: no ONECLICK_JWT. Previews still work; a deposit address cannot be issued.",
    );
    return 1;
  }

  const client = createOneClickClient({ baseUrl: env.ONECLICK_BASE_URL, jwt: env.ONECLICK_JWT });
  const tokens = createTokenRegistry({ client });
  const assets = await tokens.assets();
  const usdc = assets.find((asset) => asset.blockchain === "near" && asset.symbol === "USDC");
  if (!usdc) {
    console.error("1Click no longer lists USDC on NEAR; the check needs another route.");
    return 2;
  }

  const recipient = realRecipient ?? CHECK_ADDRESS;
  const params: InvoiceQuoteParams = {
    originAsset: usdc.assetId,
    refundTo: recipient,
    destinationAsset: usdc.assetId,
    recipient,
    amountOut: toBaseUnits("10.5", usdc.decimals),
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  console.log(`  tokens: ${assets.length} listed; ${USDC_NEAR} = ${usdc.assetId}`);
  console.log(
    realRecipient
      ? `  mode:  real quote to ${recipient} (an address is issued; nothing is sent, it expires)`
      : "  mode:  dry preview (no address is issued)",
  );

  try {
    const quote = await requestInvoiceQuote(client, params, {
      dry: realRecipient === null,
      ...(env.ONECLICK_MANAGER_PUBLIC_KEY
        ? { managerPublicKey: env.ONECLICK_MANAGER_PUBLIC_KEY }
        : {}),
    });
    console.log(
      `  quote: 200 · in ${quote.amountIn} → out ${quote.amountOut} base units · ${quote.timeEstimateS}s`,
    );
    console.log(`  fee:   ${quote.feeUsd === null ? "not reported" : `${quote.feeUsd} USD`}`);
    console.log("  signature: verified");
    if (quote.depositAddress) {
      console.log(`  deposit address: ${quote.depositAddress}`);
      console.log("Verdict: the credential can issue a deposit address. S8.4 can run.");
      return 0;
    }
    console.log(
      "Verdict: the token is accepted for a quote (dry). Run with --real to prove a deposit address.",
    );
    return 0;
  } catch (error) {
    if (error instanceof OneClickError) {
      console.error(`  failure: ${error.kind} (${error.status ?? "no response"}) ${error.detail}`);
      console.error(
        error.kind === "unauthorized"
          ? "Verdict: the token was refused. Generate a new one in the Partner Dashboard."
          : "Verdict: the credential was not proven. See the failure above.",
      );
      return 1;
    }
    throw error;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
