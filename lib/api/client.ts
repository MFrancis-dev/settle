/**
 * The browser's only door to `/api`: typed calls, one error object, no `any`.
 * Roadmap: S4.1–S4.7 · Spec: ARCHITECTURE.md §3.1 (thin routes), §6
 *
 * Every page goes through this instead of calling `fetch` itself, so the error envelope, the
 * same-origin cookies and the "a non-2xx body may not be JSON" case are handled once. The fetch
 * implementation is injected because the tests (and the offline demo) hand in a scripted one.
 */

import type { CreateInvoiceInput, DemoOutcome, PayQuoteInput } from "@/lib/core/schemas";
import type { InvoiceStatus } from "@/lib/core/status";
import type { SignInBody } from "@/lib/wallet/sign-in";
import type { PayoutBody } from "@/lib/wallet/payout-signature";
import type {
  ApiErrorCode,
  DemoSessionView,
  DemoSimulationView,
  InvoiceDetail,
  InvoiceView,
  MeView,
  PayoutChange,
  PayoutView,
  PublicInvoiceView,
  QuoteView,
  ReceiptView,
  SignedIn,
  StatusView,
  SubmitResult,
  TokenList,
  ValidationIssue,
} from "./types";

/** Anything 2xx-shaped and text-bearing; a `Response` satisfies it in the browser and in Node. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** A rejection that already carries a plain-language message for the screen the user is on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: unknown = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The rejected fields, in the order the form shows them. */
  get issues(): ValidationIssue[] {
    const list = (this.details as { issues?: unknown } | undefined)?.issues;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (issue): issue is ValidationIssue =>
        typeof issue === "object" &&
        issue !== null &&
        typeof (issue as ValidationIssue).path === "string" &&
        typeof (issue as ValidationIssue).message === "string",
    );
  }

  /** Seconds until a rate-limited call may be retried, when the server said. */
  get retryAfterS(): number | null {
    const value = (this.details as { retryAfterS?: unknown } | undefined)?.retryAfterS;
    return typeof value === "number" ? value : null;
  }

  /** The reason a signature was rejected, so settings can say *which* check failed. */
  get signatureReason(): string | null {
    const value = (this.details as { reason?: unknown } | undefined)?.reason;
    return typeof value === "string" ? value : null;
  }
}

export interface Api {
  signIn(body: SignInBody): Promise<SignedIn>;
  signOut(): Promise<void>;
  me(): Promise<MeView>;
  tokens(): Promise<TokenList>;
  invoices(opts?: { status?: InvoiceStatus; limit?: number }): Promise<InvoiceView[]>;
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceView>;
  invoice(id: string): Promise<InvoiceDetail>;
  cancelInvoice(id: string): Promise<InvoiceView>;
  payoutLog(): Promise<{ payouts: PayoutView[] }>;
  setPayout(body: PayoutBody): Promise<PayoutChange>;
  publicInvoice(publicId: string): Promise<PublicInvoiceView>;
  quote(publicId: string, input: PayQuoteInput): Promise<QuoteView>;
  status(publicId: string): Promise<StatusView>;
  submitTx(publicId: string, txHash: string): Promise<SubmitResult>;
  receipt(attemptId: string, token: string): Promise<ReceiptView>;
  /** The bare `/receipt/<token>` fallback: the token names its own attempt, so no id is needed. */
  receiptByToken(token: string): Promise<ReceiptView>;
  /** The demo's front door: seeds the fictional freelancer on first call, reads afterwards. */
  demoSession(): Promise<DemoSessionView>;
  demoReset(): Promise<DemoSessionView>;
  /** One press of the demo's "the client has paid" button. */
  demoSimulate(publicId: string, outcome: DemoOutcome): Promise<DemoSimulationView>;
}

/** Download link for the accountant's CSV; the session cookie rides along with the navigation. */
export const EXPORT_CSV_PATH = "/api/export.csv";

export function createApi(fetchImpl: FetchLike): Api {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetchImpl(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
    const text = await response.text();
    let data: unknown = null;
    if (text !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        // A proxy or crash can answer HTML on a 500; the status is still the whole story.
        if (response.ok)
          throw new ApiError(
            response.status,
            "internal_error",
            "The server replied with something we could not read.",
          );
      }
    }
    if (!response.ok) {
      const envelope = (
        data as { error?: { code?: string; message?: string; details?: unknown } } | null
      )?.error;
      throw new ApiError(
        response.status,
        (envelope?.code ?? "internal_error") as ApiErrorCode,
        envelope?.message ?? "Something went wrong. Please try again.",
        envelope?.details,
      );
    }
    return data as T;
  }

  return {
    signIn: (body) => call<SignedIn>("/api/session", { method: "POST", body }),
    signOut: () => call<void>("/api/session", { method: "DELETE" }),
    me: () => call<MeView>("/api/me"),
    tokens: () => call<TokenList>("/api/tokens"),
    invoices: (opts) => {
      const params = new URLSearchParams();
      if (opts?.status) params.set("status", opts.status);
      if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
      const query = params.toString();
      return call<InvoiceView[]>(query === "" ? "/api/invoices" : `/api/invoices?${query}`);
    },
    createInvoice: (input) => call<InvoiceView>("/api/invoices", { method: "POST", body: input }),
    invoice: (id) => call<InvoiceDetail>(`/api/invoices/${encodeURIComponent(id)}`),
    cancelInvoice: (id) =>
      call<InvoiceView>(`/api/invoices/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    payoutLog: () => call<{ payouts: PayoutView[] }>("/api/payout"),
    setPayout: (body) => call<PayoutChange>("/api/payout", { method: "PUT", body }),
    publicInvoice: (publicId) =>
      call<PublicInvoiceView>(`/api/pay/${encodeURIComponent(publicId)}`),
    quote: (publicId, input) =>
      call<QuoteView>(`/api/pay/${encodeURIComponent(publicId)}/quote`, {
        method: "POST",
        body: input,
      }),
    status: (publicId) => call<StatusView>(`/api/pay/${encodeURIComponent(publicId)}/status`),
    submitTx: (publicId, txHash) =>
      call<SubmitResult>(`/api/pay/${encodeURIComponent(publicId)}/submit-tx`, {
        method: "POST",
        body: { txHash },
      }),
    receipt: (attemptId, token) =>
      call<ReceiptView>(
        `/api/receipts/${encodeURIComponent(attemptId)}?token=${encodeURIComponent(token)}`,
      ),
    receiptByToken: (token) =>
      call<ReceiptView>(`/api/receipts?token=${encodeURIComponent(token)}`),
    demoSession: () => call<DemoSessionView>("/api/demo/session"),
    demoReset: () => call<DemoSessionView>("/api/demo/reset", { method: "POST" }),
    demoSimulate: (publicId, outcome) =>
      call<DemoSimulationView>("/api/demo/simulate-payment", {
        method: "POST",
        body: { publicId, outcome },
      }),
  };
}

/** The instance the hooks use. A page never builds its own, so there is one place to point at a stub. */
export const api = createApi(
  (input, init) =>
    fetch(input, init) as unknown as Promise<{
      ok: boolean;
      status: number;
      text(): Promise<string>;
    }>,
);
