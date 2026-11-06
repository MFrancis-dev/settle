/**
 * `PUT /api/payout` — set or change where the freelancer is paid.
 * Roadmap: S3.2 · Spec: ARCHITECTURE.md §3.5, §5, §6
 *
 * This is the one write in the app that can lose money permanently: a payment follows the address
 * stored here, and a hijacked session could otherwise change it in one request. Three controls meet
 * in this file (§6):
 *
 * 1. a **fresh** NEP-413 signature — made by a key the session's own account owns, over a message
 *    that quotes the *new* address (`payoutMessage`), with a nonce that has never been used;
 * 2. the address is typed twice and validated by `lib/core/address.ts` before anything is written;
 * 3. the previous row is kept, so the change log is the table itself and the dashboard can banner it.
 *
 * The USDC storage check is **read-only**. Registering an account spends the payer account's funds,
 * which is S2.10 and needs an explicit human "yes" (AGENTS.md §7); until then this reports what the
 * contract said and the UI explains what it means.
 */

import { NearRpcError } from "../near/rpc";
import { checkStorageRequirement, type StorageRequirement } from "../near/storage";
import { chainFromCode } from "../oneclick/tokens";
import { getActiveDestination, setActiveDestination } from "../db/queries/payoutDestinations";
import { countLiveAttemptsOnOtherDestination } from "../db/queries/paymentAttempts";
import type { PayoutDestinationRow } from "../db/schema";
import { payoutInput, type PayoutInput } from "../core/schemas";
import { payoutMessage } from "../core/payout-message";
import type { BaseUnits } from "../core/types";
import { parseJsonBody, unauthorized } from "./http";
import { checkSignedMessage } from "./signature";
import { toPayoutView, type PayoutView, type Principal } from "./auth";
import type { ServerDeps } from "./deps";

export interface StorageView {
  /** Whether the check could run at all; false fields below mean "we do not know", never "no". */
  checked: boolean;
  registered: boolean | null;
  /** `unconfigured` / `unreachable` / `no_contract` when `checked` is false. */
  reason: string | null;
  contract: string | null;
  /** What the contract charges to register (yoctoNEAR base units), read from its own bounds. */
  minimumBaseUnits: BaseUnits | null;
  topUpBaseUnits: BaseUnits | null;
}

export interface PayoutChange {
  payout: PayoutView;
  /** False when the same address was re-submitted: nothing new went into the change log. */
  changed: boolean;
  /**
   * Payments already quoted against the destination this change replaced (S7.8). FR-6 says a change
   * applies to *new* quotes only, so a non-zero count is not a problem to fix — it is the thing the
   * seller must be told, because those clients are still looking at an address that pays the old
   * destination and only the seller knows whether to chase them.
   */
  openQuotes: number;
  /** Null for a payout this check does not apply to (any non-USDC-on-NEAR destination). */
  storage: StorageView | null;
}

function unresolved(reason: string): StorageView {
  return {
    checked: false,
    registered: null,
    reason,
    contract: null,
    minimumBaseUnits: null,
    topUpBaseUnits: null,
  };
}

/** The NEP-141 contract behind a 1Click asset id: `nep141:usdc.near` → `usdc.near`. */
function nep141Contract(assetId: string): string | null {
  return assetId.startsWith("nep141:") ? assetId.slice("nep141:".length) : null;
}

async function usdcContractFor(deps: ServerDeps, input: PayoutInput): Promise<string | null> {
  if (input.chain !== "near") return null;
  const contract = nep141Contract(input.assetId);
  if (contract === null) return null;
  if (deps.usdcContractId === contract) return contract;

  const asset = await deps.tokens.find(input.assetId).catch(() => null);
  return asset?.symbol === "USDC" && chainFromCode(asset.blockchain) === "near" ? contract : null;
}

/** §3.5, read-only: would this account refuse an incoming USDC transfer? */
async function storageFor(deps: ServerDeps, input: PayoutInput): Promise<StorageView | null> {
  const contract = await usdcContractFor(deps, input);
  if (contract === null) return null;

  let requirement: StorageRequirement;
  try {
    requirement = await checkStorageRequirement(deps.nearRpc, contract, input.address);
  } catch (error) {
    if (error instanceof NearRpcError && error.kind === "not_configured") {
      return unresolved("unconfigured");
    }
    return unresolved("unreachable");
  }

  return {
    checked: true,
    registered: requirement.registered,
    reason: null,
    contract,
    minimumBaseUnits: requirement.minimum,
    topUpBaseUnits: requirement.topUp,
  };
}

export async function setPayout(
  deps: ServerDeps,
  principal: Principal,
  input: PayoutInput,
): Promise<PayoutChange> {
  const expected = payoutMessage(input.chain, input.address);
  const signed = await checkSignedMessage(deps, input, {
    accountId: principal.user.nearAccountId,
    expectedMessage: expected,
  });
  if (!signed.valid) {
    // `expectedMessage` is the string the UI must have the wallet sign; returning it makes a rejected
    // change debuggable without revealing anything the caller did not already have.
    throw unauthorized(`Payout change rejected (${signed.reason}).`, {
      reason: signed.reason,
      expectedMessage: expected,
    });
  }

  const before: PayoutDestinationRow | null = await getActiveDestination(
    deps.db,
    principal.user.id,
  );
  const row = await setActiveDestination(deps.db, {
    userId: principal.user.id,
    assetId: input.assetId,
    chain: input.chain,
    address: input.address,
  });

  return {
    payout: await toPayoutView(deps, row),
    changed: before?.id !== row.id,
    openQuotes: await countLiveAttemptsOnOtherDestination(deps.db, {
      userId: principal.user.id,
      destinationId: row.id,
    }),
    storage: await storageFor(deps, input),
  };
}

export async function setPayoutFromBody(
  deps: ServerDeps,
  principal: Principal,
  request: Request,
): Promise<PayoutChange> {
  return setPayout(deps, principal, await parseJsonBody(request, payoutInput));
}
