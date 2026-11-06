"use client";

/**
 * The wallet's own state, shared by every client component: which account the wallet is on, how to
 * get a signed message, and how to leave.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5 (wallet sign-in), PRD FR-1
 *
 * Two separate ideas live here on purpose. The wallet being connected is not the same as being
 * signed in to Settle — a wallet can name an account while our `/api/session` cookie is absent or
 * expired — so this provider only reports wallet state and hands out signatures. `useMe()` answers
 * the session question, and a page is signed in when both agree.
 *
 * It owns the single selector instance (`lib/wallet/selector.ts`) rather than using
 * `@near-wallet-selector/react-hook`: that provider calls `setupWalletSelector()` inside its render
 * body, which rebuilds the selector — and re-reads the saved wallet session — on every re-render.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WalletSelector } from "@near-wallet-selector/core";

import {
  activeAccountOf,
  activeWallet,
  getWalletSelector,
  showSignInModal,
} from "@/lib/wallet/selector";
import { signInBodyFromWallet, type MessageSigner, type SignInBody } from "@/lib/wallet/sign-in";
import { payoutBodyFromWallet, type PayoutBody } from "@/lib/wallet/payout-signature";
import { recipientFromLocation, WALLET_SUPPORTED } from "@/lib/ui/config";

export type WalletPhase = "unsupported" | "loading" | "signed-out" | "signed-in";

interface WalletContextValue {
  phase: WalletPhase;
  /** The account the wallet reports, or null before sign-in. Not proof of a Settle session. */
  accountId: string | null;
  /**
   * Open the chooser if needed, then ask the wallet to sign a fresh NEP-413 message for this host.
   * Rejects when the user closes the chooser without picking a wallet.
   */
  signInBody(): Promise<SignInBody>;
  /**
   * Sign a payout-destination change (PRD FR-6). The signed message *is* the new address, so a
   * captured signature cannot authorise a different one.
   */
  signPayoutChange(destination: {
    assetId: string;
    chain: string;
    address: string;
  }): Promise<PayoutBody>;
  /** Ask the wallet to drop its session. The caller still has to sign out of Settle itself. */
  signOutWallet(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** Thrown when the chooser closed with no wallet picked; the UI shows it as a plain dismissal. */
export class WalletCancelled extends Error {
  constructor() {
    super("Sign-in cancelled.");
    this.name = "WalletCancelled";
  }
}

/**
 * The account the user ends up on: the current one, or the one the chooser produces.
 *
 * The store, not the modal's `onHide`, is the success signal — a wallet that signs in through a popup
 * or a redirect closes the modal itself, so "the modal closed" says nothing on its own.
 */
function waitForAccount(selector: WalletSelector): Promise<string> {
  const already = activeAccountOf(selector);
  if (already) return Promise.resolve(already);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      subscription.unsubscribe();
      fn();
    };

    const subscription = selector.store.observable.subscribe((state) => {
      const active = state.accounts.find((account) => account.active) ?? state.accounts[0];
      if (active) settle(() => resolve(active.accountId));
    });

    showSignInModal((reason) => {
      // "wallet-navigation" means the user is mid-flow in their own wallet; keep waiting.
      if (reason === "user-triggered") settle(() => reject(new WalletCancelled()));
    }).catch(() => settle(() => reject(new Error("Could not open the wallet chooser."))));
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<WalletPhase>(WALLET_SUPPORTED ? "loading" : "unsupported");
  const [accountId, setAccountId] = useState<string | null>(null);
  const selectorRef = useRef<WalletSelector | null>(null);

  useEffect(() => {
    if (!WALLET_SUPPORTED) return;
    let cancelled = false;

    getWalletSelector().then((selector) => {
      if (cancelled) return;
      selectorRef.current = selector;
      const restore = (id: string | null) => {
        setAccountId(id);
        setPhase(id ? "signed-in" : "signed-out");
      };
      restore(activeAccountOf(selector));

      const signedIn = () => restore(activeAccountOf(selector));
      const signedOut = () => restore(null);
      selector.on("signedIn", signedIn);
      selector.on("signedOut", signedOut);
      selector.on("accountsChanged", signedIn);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Connect if needed, then hand the active wallet to `use` for one signature. */
  const withSigner = useCallback(
    async <T,>(use: (signer: MessageSigner, account: string) => Promise<T>): Promise<T> => {
      if (!WALLET_SUPPORTED) throw new Error("This browser cannot sign in with a wallet.");
      const selector = selectorRef.current ?? (await getWalletSelector());
      const account = await waitForAccount(selector);
      const wallet = await activeWallet(selector);
      return use(wallet, account);
    },
    [],
  );

  const signInBody = useCallback(
    () =>
      withSigner((signer) => signInBodyFromWallet({ signer, recipient: recipientFromLocation() })),
    [withSigner],
  );

  const signPayoutChange = useCallback(
    (destination: { assetId: string; chain: string; address: string }) =>
      withSigner((signer) =>
        payoutBodyFromWallet({ signer, recipient: recipientFromLocation(), destination }),
      ),
    [withSigner],
  );

  const signOutWallet = useCallback(async (): Promise<void> => {
    const selector = selectorRef.current;
    if (!selector) return;
    const wallet = await activeWallet(selector);
    await wallet.signOut();
    setAccountId(null);
    setPhase("signed-out");
  }, []);

  const value = useMemo(
    () => ({ phase, accountId, signInBody, signPayoutChange, signOutWallet }),
    [phase, accountId, signInBody, signPayoutChange, signOutWallet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>.");
  return context;
}
