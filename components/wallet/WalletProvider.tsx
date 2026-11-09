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

import { api } from "@/lib/api/client";
import { payoutBodyFromWallet, type PayoutBody } from "@/lib/wallet/payout-signature";
import { signInBodyFromWallet, type MessageSigner, type SignInBody } from "@/lib/wallet/sign-in";
import { WALLET_SUPPORTED } from "@/lib/ui/config";

/**
 * The single runtime edge into `@near-wallet-selector/*`. It is a dynamic import, not a static one,
 * so a page that only *links* to sign-in (the landing hero, the header) keeps the whole wallet stack
 * out of its first bundle — it is fetched as its own async chunk instead. `import type` above is
 * erased at build, so nothing here pulls the package into the graph. #110
 */
const loadSelector = () => import("@/lib/wallet/selector");
type SelectorModule = Awaited<ReturnType<typeof loadSelector>>;

export type WalletPhase = "unsupported" | "loading" | "signed-out" | "signed-in";

interface WalletContextValue {
  phase: WalletPhase;
  /** The account the wallet reports, or null before sign-in. Not proof of a Settle session. */
  accountId: string | null;
  /**
   * Ask Settle for a challenge, then ask the wallet to sign it.
   *
   * The challenge is fetched after the wallet is connected rather than on page load, so the five
   * minutes it is good for are spent opening the chooser and signing, not sitting in a tab. Rejects
   * when the user closes the chooser without picking a wallet.
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
function waitForAccount(selector: WalletSelector, selectorModule: SelectorModule): Promise<string> {
  const already = selectorModule.activeAccountOf(selector);
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

    selectorModule
      .showSignInModal((reason) => {
        // "wallet-navigation" means the user is mid-flow in their own wallet; keep waiting.
        if (reason === "user-triggered") settle(() => reject(new WalletCancelled()));
      })
      .catch(() => settle(() => reject(new Error("Could not open the wallet chooser."))));
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  // Seeded without `WALLET_SUPPORTED`: that constant reads `window`, so on the server the first
  // render was `unsupported` ("Wallet sign-in unavailable", disabled) and in the browser `loading`
  // ("Sign in with your wallet") — React discarded the server's markup (#418). The effect below
  // resolves the real answer after mount, which is the only place `window` may be read. #140
  const [phase, setPhase] = useState<WalletPhase>("loading");
  const [accountId, setAccountId] = useState<string | null>(null);
  const selectorRef = useRef<WalletSelector | null>(null);

  useEffect(() => {
    if (!WALLET_SUPPORTED) {
      setPhase("unsupported");
      return;
    }
    let cancelled = false;

    loadSelector().then(async (selectorModule) => {
      const selector = await selectorModule.getWalletSelector();
      if (cancelled) return;
      selectorRef.current = selector;
      const restore = (id: string | null) => {
        setAccountId(id);
        setPhase(id ? "signed-in" : "signed-out");
      };
      restore(selectorModule.activeAccountOf(selector));

      const signedIn = () => restore(selectorModule.activeAccountOf(selector));
      const signedOut = () => restore(null);
      selector.on("signedIn", signedIn);
      selector.on("signedOut", signedOut);
      selector.on("accountsChanged", signedIn);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Connect if needed, then hand the active wallet to `use` for one signature.
   * `use` fetches its own server challenge inside here on purpose: the chooser has been dealt with by
   * the time the nonce is minted, so it is spent within its window (#109).
   */
  const withSigner = useCallback(
    async <T,>(use: (signer: MessageSigner, account: string) => Promise<T>): Promise<T> => {
      if (!WALLET_SUPPORTED) throw new Error("This browser cannot sign in with a wallet.");
      const selectorModule = await loadSelector();
      const selector = selectorRef.current ?? (await selectorModule.getWalletSelector());
      const account = await waitForAccount(selector, selectorModule);
      const wallet = await selectorModule.activeWallet(selector);
      return use(wallet, account);
    },
    [],
  );

  const signInBody = useCallback(
    () =>
      withSigner(async (signer) => {
        const challenge = await api.authChallenge("session");
        return signInBodyFromWallet({
          signer,
          recipient: challenge.recipient,
          nonce: challenge.nonce,
        });
      }),
    [withSigner],
  );

  const signPayoutChange = useCallback(
    (destination: { assetId: string; chain: string; address: string }) =>
      withSigner(async (signer) => {
        const challenge = await api.authChallenge("payout");
        return payoutBodyFromWallet({
          signer,
          recipient: challenge.recipient,
          destination,
          nonce: challenge.nonce,
        });
      }),
    [withSigner],
  );

  const signOutWallet = useCallback(async (): Promise<void> => {
    const selector = selectorRef.current;
    if (!selector) return;
    const selectorModule = await loadSelector();
    const wallet = await selectorModule.activeWallet(selector);
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
