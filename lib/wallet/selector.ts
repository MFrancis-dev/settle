/**
 * The one wallet-selector instance in the app.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5 (wallet sign-in), §11 (S0.14 answer)
 *
 * Set up once, lazily, and shared: `setupWalletSelector` reads the saved session from storage and
 * rebuilding it on every render would re-run that and drop the subscription the provider installs.
 * The `buffer-global` import must stay first — the library checks `Buffer.isBuffer(nonce)`, and Next
 * does not provide that global in the browser.
 */

import "@/lib/wallet/buffer-global";

import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";

import { NEAR_NETWORK } from "@/lib/ui/config";

let pendingSelector: Promise<WalletSelector> | null = null;

/**
 * MyNearWallet and HOT are the two modules whose `signMessage` was read in the installed code
 * (ARCHITECTURE.md §11). Both implement the NEP-413 standard message; neither can be asked for an
 * EVM signature, which is why MetaMask is not on this list.
 */
export function getWalletSelector(): Promise<WalletSelector> {
  pendingSelector ??= setupWalletSelector({
    network: NEAR_NETWORK,
    modules: [setupMyNearWallet(), setupHotWallet()],
  });
  return pendingSelector;
}

let modal: WalletSelectorModal | null = null;

/**
 * Why the chooser closed. The library distinguishes the two, which is what lets the provider tell
 * "the user pressed escape" apart from "the user went off to their wallet" — resolving a sign-in as
 * cancelled while the wallet is still open would lose a signature that is about to arrive.
 */
export type SignInDismissal = "user-triggered" | "wallet-navigation";

/**
 * Open the wallet chooser. No `contractId` is passed: Settle never calls a contract, so sign-in asks
 * the wallet to prove the account controls a key (NEP-413) instead of granting Settle an access key
 * it could use later.
 */
export async function showSignInModal(onDismissed?: (reason: SignInDismissal) => void): Promise<void> {
  const selector = await getWalletSelector();
  if (modal === null) {
    modal = setupModal(selector, { theme: "light" });
  }
  if (onDismissed) {
    modal.on("onHide", ({ hideReason }) => onDismissed(hideReason));
  }
  modal.show();
}

/** The wallet the user chose (or had chosen), ready to sign. `signMessage` is always present here. */
export async function activeWallet(selector: WalletSelector) {
  return selector.wallet();
}

/** The account the wallet reports as signed in, before any subscription event has arrived. */
export function activeAccountOf(selector: WalletSelector): string | null {
  return selector.store.getState().accounts.find((account) => account.active)?.accountId ?? null;
}
