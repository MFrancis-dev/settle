/**
 * `/v0/status` polling and `/v0/deposit/submit`.
 * Roadmap: S2.3 · Spec: ARCHITECTURE.md §3.3, §3.4
 *
 * The status response echoes the whole quote, so the worker can keep the exact quote it is
 * reporting on (`raw`) without a second call — that echo is what a receipt is signed against.
 * `depositedAmount`/`refundedAmount` are the only place the *actual* on-chain figures appear,
 * which is how an over- or under-payment is distinguished from the quoted one (S7.x).
 *
 * A deposit memo is required whenever the quote used `MEMO` deposit mode, so it is threaded
 * through rather than guessed at.
 */

import { GetExecutionStatusResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { z } from "zod";

import type { BaseUnits } from "../core/types";
import {
  attemptStatusFromOneClick,
  type AttemptStatus,
  type OneClickStatus,
  ONECLICK_STATUSES,
} from "../core/status";
import { parseBaseUnits } from "../core/money";
import { quoteResponseSchema } from "./quote";
import type { OneClickClient } from "./client";

/** The union in `lib/core/status.ts` is the only source of truth; a test pins the SDK's list. */
export const oneClickStatusSchema = z.enum(ONECLICK_STATUSES);

/** Exactly what the installed SDK declares; pinned against the union in `status.test.ts`. */
export const SDK_ONECLICK_STATUSES: readonly string[] = Object.values(
  GetExecutionStatusResponse.status,
);

const transactionSchema = z
  .object({ hash: z.string().min(1), explorerUrl: z.string().min(1) })
  .passthrough();

const swapDetailsSchema = z
  .object({
    intentHashes: z.array(z.string()).default([]),
    nearTxHashes: z.array(z.string()).default([]),
    originChainTxHashes: z.array(transactionSchema).default([]),
    destinationChainTxHashes: z.array(transactionSchema).default([]),
    amountIn: z.string().regex(/^\d+$/).optional(),
    amountOut: z.string().regex(/^\d+$/).optional(),
    depositedAmount: z.string().regex(/^\d+$/).optional(),
    refundedAmount: z.string().regex(/^\d+$/).optional(),
    refundReason: z.string().optional(),
    withdrawFee: z.string().optional(),
  })
  .passthrough();

export const executionStatusSchema = z
  .object({
    correlationId: z.string(),
    status: oneClickStatusSchema,
    updatedAt: z.string(),
    swapDetails: swapDetailsSchema,
    /** May be absent for a quote the service no longer keeps. Never used for money math. */
    quoteResponse: quoteResponseSchema.optional(),
  })
  .passthrough();

export interface ExecutionStatus {
  status: OneClickStatus;
  /** The mapped Settle-side status, so callers never re-implement the table (ARCHITECTURE §3.3). */
  attemptStatus: AttemptStatus;
  updatedAt: string;
  /** What actually landed on the deposit address, in origin-asset base units. */
  depositedAmount: BaseUnits | null;
  /** Sent back to `refundTo`, in origin-asset base units, plus why. */
  refundedAmount: BaseUnits | null;
  refundReason: string | null;
  /** Settled trade amounts, present once the swap has executed. */
  settledAmountIn: BaseUnits | null;
  settledAmountOut: BaseUnits | null;
  depositTxHashes: readonly string[];
  deliveryTxHashes: readonly string[];
  intentHashes: readonly string[];
  raw: unknown;
}

function optionalBaseUnits(value: string | undefined): BaseUnits | null {
  return value === undefined ? null : parseBaseUnits(value);
}

/**
 * Read one payment's status. `not_found` (404) is returned as a thrown `OneClickError` — the
 * worker treats that as "no signal yet", it must never be confused with `FAILED`.
 */
export async function getExecutionStatus(
  client: OneClickClient,
  depositAddress: string,
  depositMemo?: string | null,
): Promise<ExecutionStatus> {
  const parsed = await client.requestJson(executionStatusSchema, {
    method: "GET",
    path: "/v0/status",
    query: { depositAddress, depositMemo: depositMemo ?? undefined },
  });

  return {
    status: parsed.status,
    attemptStatus: attemptStatusFromOneClick(parsed.status),
    updatedAt: parsed.updatedAt,
    depositedAmount: optionalBaseUnits(parsed.swapDetails.depositedAmount),
    refundedAmount: optionalBaseUnits(parsed.swapDetails.refundedAmount),
    refundReason: parsed.swapDetails.refundReason ?? null,
    settledAmountIn: optionalBaseUnits(parsed.swapDetails.amountIn),
    settledAmountOut: optionalBaseUnits(parsed.swapDetails.amountOut),
    depositTxHashes: parsed.swapDetails.originChainTxHashes.map((tx) => tx.hash),
    deliveryTxHashes: parsed.swapDetails.destinationChainTxHashes.map((tx) => tx.hash),
    intentHashes: parsed.swapDetails.intentHashes,
    raw: parsed,
  };
}

export interface SubmitDepositTxParams {
  txHash: string;
  depositAddress: string;
  depositMemo?: string | null;
  /** Only meaningful for a NEAR-origin deposit; ignored otherwise by the service. */
  nearSenderAccount?: string;
}

const submitDepositTxResponseSchema = z
  .object({
    correlationId: z.string(),
    status: oneClickStatusSchema,
    updatedAt: z.string(),
  })
  .passthrough();

/**
 * Tell the service a deposit exists so it can start verifying before the chain finalises.
 * This is an optimisation, not a state change: a failure to submit never means the deposit
 * was lost, so callers log and keep polling `/v0/status`.
 */
export async function submitDepositTx(
  client: OneClickClient,
  params: SubmitDepositTxParams,
): Promise<{ status: OneClickStatus; updatedAt: string }> {
  const parsed = await client.requestJson(submitDepositTxResponseSchema, {
    method: "POST",
    path: "/v0/deposit/submit",
    body: {
      txHash: params.txHash,
      depositAddress: params.depositAddress,
      memo: params.depositMemo ?? undefined,
      nearSenderAccount: params.nearSenderAccount,
    },
  });
  return { status: parsed.status, updatedAt: parsed.updatedAt };
}
