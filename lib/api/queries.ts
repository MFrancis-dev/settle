/**
 * React Query hooks: the pages' shared cache, polling and invalidation.
 * Roadmap: S4.1–S4.7 · Spec: ARCHITECTURE.md §5, PRD FR-17 (status visible within ~10 s)
 *
 * One place decides the cache rules, so a quote is never read from a stale cache and a 4xx is never
 * retried into a rate limit. Polling is 5 s, matching the worker's own cadence and staying well inside
 * the status route's per-address budget.
 */

import { useMutation, useQuery, useQueryClient, type QueryClientConfig } from "@tanstack/react-query";

import { ApiError, api } from "./client";
import type { CreateInvoiceInput, PayQuoteInput } from "@/lib/core/schemas";
import type { InvoiceStatus } from "@/lib/core/status";
import type { SignInBody } from "@/lib/wallet/sign-in";
import type { PayoutBody } from "@/lib/wallet/payout-signature";

export const STATUS_POLL_MS = 5_000;

/** Client-side cache policy. A server error is not retried; a client error never is. */
export const QUERY_DEFAULTS: NonNullable<QueryClientConfig["defaultOptions"]> = {
  queries: {
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status < 500 ? false : failureCount < 2,
    staleTime: 0,
    refetchOnWindowFocus: true,
  },
  mutations: { retry: false },
};

export const queryKeys = {
  me: ["me"] as const,
  /** Prefix for invalidating every status-filtered list at once. */
  invoicesRoot: ["invoices"] as const,
  tokens: ["tokens"] as const,
  invoices: (status?: InvoiceStatus) => ["invoices", status ?? "all"] as const,
  invoice: (id: string) => ["invoice", id] as const,
  payoutLog: ["payout-log"] as const,
  publicInvoice: (publicId: string) => ["public-invoice", publicId] as const,
  status: (publicId: string) => ["pay-status", publicId] as const,
  receipt: (attemptId: string, token: string) => ["receipt", attemptId, token] as const,
};

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.me() });
}

export function useTokens() {
  return useQuery({ queryKey: queryKeys.tokens, queryFn: () => api.tokens() });
}

export function useInvoices(status?: InvoiceStatus) {
  return useQuery({
    queryKey: queryKeys.invoices(status),
    queryFn: () => api.invoices(status === undefined ? undefined : { status }),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: queryKeys.invoice(id),
    queryFn: () => api.invoice(id),
    enabled: id !== "",
  });
}

export function usePayoutLog() {
  return useQuery({ queryKey: queryKeys.payoutLog, queryFn: () => api.payoutLog().then((r) => r.payouts) });
}

export function usePublicInvoice(publicId: string) {
  return useQuery({
    queryKey: queryKeys.publicInvoice(publicId),
    queryFn: () => api.publicInvoice(publicId),
  });
}

/**
 * The pay page's poll. It is only enabled while something is actually in flight, so a settled or
 * cancelled invoice stops asking instead of spending the visitor's rate-limit share.
 */
export function usePaymentStatus(publicId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.status(publicId),
    queryFn: () => api.status(publicId),
    enabled,
    refetchInterval: STATUS_POLL_MS,
  });
}

/**
 * A receipt is a record of something that already happened, so it is read once and never polled.
 * Both halves of the pair are needed: the attempt id picks the row, the token proves the link.
 */
export function useReceipt(attemptId: string | null, token: string) {
  return useQuery({
    queryKey: queryKeys.receipt(attemptId ?? "", token),
    queryFn: () => api.receipt(attemptId ?? "", token),
    enabled: attemptId !== null && attemptId !== "" && token !== "",
  });
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SignInBody) => api.signIn(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => client.clear(),
  });
}

export function useCreateInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => api.createInvoice(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.invoicesRoot }),
  });
}

export function useCancelInvoice(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelInvoice(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.invoicesRoot });
      client.invalidateQueries({ queryKey: queryKeys.invoice(id) });
    },
  });
}

export function useSetPayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PayoutBody) => api.setPayout(body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.me });
      client.invalidateQueries({ queryKey: queryKeys.payoutLog });
    },
  });
}

export function useQuote(publicId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PayQuoteInput) => api.quote(publicId, input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.publicInvoice(publicId) });
      client.invalidateQueries({ queryKey: queryKeys.status(publicId) });
    },
  });
}

export function useSubmitTx(publicId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (txHash: string) => api.submitTx(publicId, txHash),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.status(publicId) }),
  });
}
