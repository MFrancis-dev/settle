"use client";

/**
 * The one control that gets a freelancer into Settle: connect, sign, open a session.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §5, PRD FR-1, FR-2
 *
 * Sign-in is three steps that a person should only have to press once: the chooser produces an
 * account, the wallet signs a fresh NEP-413 message, and `POST /api/session` turns that into a cookie.
 * A cancelled chooser is not an error worth shouting about, so it is swallowed and the button just
 * returns to idle.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { WalletCancelled, useWallet } from "./WalletProvider";
import { useSignIn } from "@/lib/api/queries";

export function SignInButton({
  redirectTo,
  size = "md",
  full = false,
}: {
  /** Path to open once the session exists. Omit to let the page react to the cookie itself. */
  redirectTo?: string;
  size?: "sm" | "md" | "lg";
  full?: boolean;
}) {
  const { phase, accountId, signInBody, signOutWallet } = useWallet();
  const signIn = useSignIn();
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);

  async function connect() {
    setFeedback(null);
    try {
      const body = await signInBody();
      await signIn.mutateAsync(body);
      if (redirectTo) router.push(redirectTo);
    } catch (error) {
      if (error instanceof WalletCancelled) return;
      setFeedback(messageFor(error));
    }
  }

  if (phase === "signed-in" && accountId) {
    return (
      <button
        type="button"
        className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
        onClick={signOutWallet}
      >
        {accountId} · disconnect
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={phase === "signed-out" ? "primary" : "secondary"}
        size={size}
        full={full}
        pending={phase === "loading" || signIn.isPending}
        disabled={phase === "unsupported" || signIn.isPending}
        onClick={connect}
      >
        {phase === "unsupported"
          ? "Wallet sign-in unavailable"
          : phase === "signed-out"
            ? "Sign in with your wallet"
            : "Sign in with your wallet"}
      </Button>
      {feedback ? <p className="text-xs text-danger">{feedback}</p> : null}
    </div>
  );
}

/** A wallet rejection arrives as a bare string from the library; the person needs to know what to do. */
function messageFor(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel/i.test(text)) return "Your wallet declined to sign. Try again when you are ready.";
  if (/session|cookie/i.test(text)) return "Settle could not open a session with that signature. Try again.";
  return "Sign-in did not complete. Check your wallet and try again.";
}
