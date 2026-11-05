/**
 * Register USDC-on-NEAR storage for payout accounts (the storage-payer path).
 * Roadmap: S2.8 · Spec: ARCHITECTURE.md §3.2, §11
 *
 * Why this exists at all: a NEP-141 token contract refuses an `ft_transfer` to an account with no
 * storage balance, and 1Click documents no storage payment on its side — its low-level
 * `ft_withdraw` intent warns that a missing `storage_deposit` simply means no refund
 * (ARCHITECTURE.md §11, S0.9). So a freelancer whose payout address has never held USDC would
 * silently fail to be paid, and Settle pays the deposit from its own payer account.
 *
 * Everything here is read-only decision-making. Sending the `storage_deposit` transaction moves
 * real funds from a real account and is gated behind an explicit human "yes" (AGENTS.md §7), so
 * it lives in S2.10, not in this file: that task also needs the funded payer (S0.10) and the
 * NEAR transaction-signing dependency (S0.14), neither of which exists yet.
 */

import { formatAmount, parseBaseUnits, sumAmounts } from "../core/money";
import type { BaseUnits } from "../core/types";
import {
  storageBalanceBounds,
  storageBalanceOf,
  NearRpcError,
  type NearRpcConfig,
  type StorageBalance,
} from "./rpc";

/** yoctoNEAR is NEAR's own fixed unit — 10^-24 NEAR — and not a 1Click asset, so it is a chain constant. */
export const NEAR_DECIMALS = 24;

export interface StorageRequirement {
  accountId: string;
  /** Already registered with at least the contract's minimum: nothing to do. */
  registered: boolean;
  balance: StorageBalance | null;
  /** What the contract charges to register, read from `storage_balance_bounds.min`. */
  minimum: BaseUnits;
  /** Base units still needed to reach `minimum`, so the full minimum when unregistered. */
  topUp: BaseUnits;
}

/**
 * Ask the contract what the payout account holds, then what it needs.
 * `rpc_error` for `storage_balance_of` means the account does not exist yet — still a payout
 * target (an address is valid before it is funded), so it is treated as unregistered rather
 * than as a failure. Any other error is re-thrown: a wrong "needs registration" answer spends
 * payer funds, and a wrong "already registered" answer loses the freelancer's payment.
 */
export async function checkStorageRequirement(
  config: NearRpcConfig,
  contractId: string,
  accountId: string,
): Promise<StorageRequirement> {
  const bounds = await storageBalanceBounds(config, contractId);

  let balance: StorageBalance | null;
  try {
    balance = await storageBalanceOf(config, contractId, accountId);
  } catch (cause) {
    if (cause instanceof NearRpcError && cause.kind === "rpc_error") {
      balance = null;
    } else {
      throw cause;
    }
  }

  const held = BigInt(balance?.total ?? "0");
  const minimum = BigInt(bounds.min);
  const shortfall = minimum - held > 0n ? minimum - held : 0n;
  return {
    accountId,
    registered: shortfall === 0n,
    balance,
    minimum: bounds.min,
    topUp: parseBaseUnits(shortfall.toString()),
  };
}

/** Payout accounts in `requirements` that would refuse an incoming transfer. */
export function unregisteredAccounts(requirements: readonly StorageRequirement[]): string[] {
  return requirements.filter((requirement) => !requirement.registered).map((r) => r.accountId);
}

/** Total payer-account cost of registering every unregistered address in one pass. */
export function totalRegistrationCost(requirements: readonly StorageRequirement[]): BaseUnits {
  return sumAmounts(
    requirements.filter((requirement) => !requirement.registered).map((r) => r.topUp),
  );
}

/** Human-facing cost, e.g. "0.02 NEAR" — the number a UI shows before asking for the "yes". */
export function formatRegistrationCost(amount: BaseUnits): string {
  return `${formatAmount(amount, NEAR_DECIMALS)} NEAR`;
}

/**
 * The action payload a `storage_deposit` call needs, built here so S2.10 only has to sign and
 * send. `attachedDeposit` is what the payer actually attaches; it must be at least `minimum`.
 */
export function buildStorageDepositAction(
  accountId: string,
  attachedDeposit: BaseUnits,
): { methodName: "storage_deposit"; args: { account_id: string }; attachedDeposit: BaseUnits } {
  if (BigInt(attachedDeposit) <= 0n) {
    throw new RangeError("a storage_deposit must attach a positive deposit");
  }
  return { methodName: "storage_deposit", args: { account_id: accountId }, attachedDeposit };
}
