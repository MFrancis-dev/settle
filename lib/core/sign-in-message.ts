/**
 * The exact string a wallet shows when signing in.
 * Roadmap: S4.1, S7.12 (#109) · Spec: ARCHITECTURE.md §5
 *
 * Shared because two places render it: the browser builds it when signing, and `GET
 * /api/auth/challenge` (which cannot import the wallet module) hands the same text back so the dialog
 * a person approves names the one host the signature is bound to. For sign-in the server checks the
 * recipient and the issued nonce, not this wording, but keeping it in one place is what stops the
 * dialog and the API drifting apart.
 */

export function signInMessage(recipient: string): string {
  return `Settle sign-in for ${recipient}`;
}
