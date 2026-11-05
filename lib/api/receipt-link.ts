/**
 * The receipt URL the app links to.
 * Roadmap: S4.6 · Spec: ARCHITECTURE.md §3.1, §6
 *
 * `GET /api/receipts/:attemptId?token=` is authorised by the token, but it still needs the attempt's
 * own id to find the row, and `AttemptView.receiptUrl` carries only the token. So the app appends the
 * id it was handed in the same response — the token stays the credential, the id is only a lookup key.
 *
 * A receipt link typed in from an email has the token and not the id, which that route cannot serve.
 * That gap is filed as its own issue (a token-only read); until it lands this is the working path.
 */

import type { AttemptView } from "./types";

export function receiptHref(attempt: Pick<AttemptView, "id"> & { receiptUrl: string }): string {
  const url = new URL(attempt.receiptUrl);
  url.searchParams.set("attempt", attempt.id);
  return url.toString();
}
