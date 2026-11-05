/**
 * Sign-in, sign-out and "who am I" — the session side of the API.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1, §5, §6
 *
 * A NEP-413 message proves a wallet signed something; it does **not** name the account that signed
 * it. So sign-in is three checks in one place: the signature is cryptographically valid, the key
 * that made it is one of the account's own access keys (`deps.accessKeys`), and the nonce has never
 * been used before (`deps.nonces`). Drop any one of the three and a captured signature becomes a
 * reusable login — which is why a real sign-in cannot run without `NEAR_RPC_URL`.
 */

import { chainFromCode } from "../oneclick/tokens";
import {
  findUserById,
  findUserByNearAccount,
  upsertUserByNearAccount,
  type NewUserInput,
} from "../db/queries/users";
import {
  getActiveDestination,
  listDestinations,
  setActiveDestination,
} from "../db/queries/payoutDestinations";
import type { PayoutDestinationRow, User } from "../db/schema";
import type { Asset } from "../core/types";
import { signInInput, type SignInInput } from "../core/schemas";
import { parseJsonBody, unauthorized } from "./http";
import { requireSigned } from "./signature";
import { readSession, serializeSessionCookie, type SessionPayload } from "./session";
import type { ServerDeps } from "./deps";

/** The payout Settle starts a new account on: USDC on NEAR, paid to the account itself (§5). */
const DEFAULT_PAYOUT = { symbol: "USDC", chain: "near" } as const;

export interface SignedIn {
  user: User;
  /** The finished `Set-Cookie` value; the route only has to attach it. */
  cookie: string;
  isNew: boolean;
}

export interface Principal {
  session: SessionPayload;
  user: User;
}

/** Resolve the default payout asset id from the live token list — never from a hardcoded string. */
async function defaultPayoutAssetId(deps: ServerDeps): Promise<string | null> {
  if (deps.usdcContractId) return `nep141:${deps.usdcContractId}`;
  const assets = await deps.tokens.assets();
  const found = assets.find(
    (asset) =>
      asset.symbol === DEFAULT_PAYOUT.symbol && chainFromCode(asset.blockchain) === DEFAULT_PAYOUT.chain,
  );
  return found?.assetId ?? null;
}

/**
 * New accounts get the default destination so the first invoice is payable without a settings visit.
 * A token-list failure must not lock anybody out of their own account, so this is allowed to do
 * nothing — the pay page then says plainly that no payout address is set yet.
 */
async function ensureDefaultDestination(deps: ServerDeps, user: User): Promise<void> {
  if ((await getActiveDestination(deps.db, user.id)) !== null) return;

  let assetId: string | null;
  try {
    assetId = await defaultPayoutAssetId(deps);
  } catch (error) {
    console.warn(`payout default skipped, token list unavailable (${String(error)})`);
    return;
  }
  if (assetId === null) return;

  await setActiveDestination(deps.db, {
    userId: user.id,
    assetId,
    chain: DEFAULT_PAYOUT.chain,
    address: user.nearAccountId,
  });
}

export async function signIn(deps: ServerDeps, input: SignInInput): Promise<SignedIn> {
  // Sign-in proves "this account signed a message for this app, with a nonce never used before".
  await requireSigned(deps, input, { accountId: input.accountId });

  const existing = await findUserByNearAccount(deps.db, input.accountId);
  const profile: NewUserInput = {
    nearAccountId: input.accountId,
    // A returning freelancer keeps the name they chose; the account id is only the first default.
    displayName: existing?.displayName ?? input.accountId,
    email: existing?.email ?? null,
    isDemo: existing?.isDemo ?? false,
  };
  const user = await upsertUserByNearAccount(deps.db, profile);
  await ensureDefaultDestination(deps, user);

  const value = await deps.sessions.issue({
    userId: user.id,
    nearAccountId: user.nearAccountId,
    isDemo: user.isDemo,
  });

  return {
    user,
    isNew: existing === null,
    cookie: serializeSessionCookie(value, { secure: deps.secureCookies }),
  };
}

export async function signInFromBody(deps: ServerDeps, request: Request): Promise<SignedIn> {
  return signIn(deps, await parseJsonBody(request, signInInput));
}

/** The session owner, or a 401 — every `/api/me`, `/api/payout` and `/api/invoices` route starts here. */
export async function requireSession(
  deps: ServerDeps,
  request: { headers: Headers },
): Promise<Principal> {
  const session = await readSession(request, deps.sessions);
  const user = await findUserById(deps.db, session.userId);
  if (!user) throw unauthorized("This session no longer matches an account.");
  return { session, user };
}

/** Token metadata is display sugar: an unreachable list must not blank a profile page. */
async function assetFor(deps: ServerDeps, assetId: string): Promise<Asset | null> {
  try {
    return await deps.tokens.find(assetId);
  } catch {
    return null;
  }
}

export interface PayoutView {
  assetId: string;
  assetSymbol: string | null;
  /** Null when the token list is unavailable; amounts stay in exact base units. */
  decimals: number | null;
  chain: string;
  address: string;
  since: string;
  active: boolean;
  deactivatedAt: string | null;
}

export async function toPayoutView(deps: ServerDeps, row: PayoutDestinationRow): Promise<PayoutView> {
  const asset = await assetFor(deps, row.assetId);
  return {
    assetId: row.assetId,
    assetSymbol: asset?.symbol ?? null,
    decimals: asset?.decimals ?? null,
    chain: row.chain,
    address: row.address,
    since: row.createdAt.toISOString(),
    active: row.active,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}

export async function payoutHistory(deps: ServerDeps, user: User): Promise<PayoutView[]> {
  return Promise.all((await listDestinations(deps.db, user.id)).map((row) => toPayoutView(deps, row)));
}

export interface MeView {
  nearAccountId: string;
  displayName: string;
  email: string | null;
  isDemo: boolean;
  /** Null until a payout destination exists — the dashboard turns that into a call to action. */
  payout: PayoutView | null;
}

export async function meView(deps: ServerDeps, user: User): Promise<MeView> {
  const history = await payoutHistory(deps, user);
  return {
    nearAccountId: user.nearAccountId,
    displayName: user.displayName,
    email: user.email,
    isDemo: user.isDemo,
    payout: history.find((row) => row.active) ?? null,
  };
}
