/**
 * The composition root: environment + database → the one object every route handler is given.
 * Roadmap: S3.1 · Spec: ARCHITECTURE.md §3.1, §8 · project_structure.md §1 (import direction)
 *
 * Handlers take their services as arguments instead of importing singletons, which is what makes the
 * route tests real: they install a PGlite database, a scripted `fetch` and a fake RPC, then call the
 * same `route.ts` exports the deployed app calls — no mocks of our own code (AGENTS.md §8).
 *
 * `lib/server` sits above `lib/db`, `lib/oneclick` and `lib/near`, so this is the only place those
 * three are wired together.
 */

import { createOneClickClient, type FetchLike, type OneClickClient } from "../oneclick/client";
import { createTokenRegistry, type TokenRegistry } from "../oneclick/tokens";
import { getAccessKeys, type NearRpcConfig, type RpcFetch } from "../near/rpc";
import type { Database } from "../db/client";
import { getDatabase } from "./db";
import { parseEnv, type Env } from "./env-schema";
import { createNonceStore, type NonceStore } from "./nonces";
import { createRateLimiter, QUOTE_LIMIT, STATUS_LIMIT, type RateLimiter } from "./rateLimit";
import {
  createSessionCodec,
  expectedRecipient,
  isSecurePublicUrl,
  sessionSecretFrom,
  type SessionCodec,
} from "./session";

export interface ServerDeps {
  readonly db: Database;
  readonly env: Env;
  readonly oneClick: OneClickClient;
  readonly tokens: TokenRegistry;
  readonly sessions: SessionCodec;
  readonly nonces: NonceStore;
  readonly quoteLimits: RateLimiter;
  readonly statusLimits: RateLimiter;
  /** `url` is `NEAR_RPC_URL`; the reads below fail closed with `not_configured` when it is unset. */
  readonly nearRpc: NearRpcConfig;
  /** Override for the USDC-on-NEAR contract id; otherwise resolved from the token list. */
  readonly usdcContractId: string | null;
  /**
   * Key expected to sign a quote. Null uses the SDK's built-in production manager key; a value is
   * what lets a rotation (or a test fixture signed by a throwaway key) verify without a code change.
   */
  readonly managerPublicKey: string | null;
  readonly appUrl: string;
  readonly expectedRecipient: string;
  readonly secureCookies: boolean;
  readonly now: () => number;
  /**
   * The public keys an account owns. A NEP-413 payload does not name its signer, so this RPC read is
   * what binds a signature to the session's account — without it, any valid signature would prove
   * nothing about *who* authorised a payout change.
   */
  readonly accessKeys: (accountId: string) => Promise<readonly string[]>;
}

export interface ServerDepsConfig {
  db: Database;
  env?: Env;
  /** 1Click transport; tests hand in a fixture-driven `fetch` (AGENTS.md §8). */
  oneClickFetch?: FetchLike;
  nearFetch?: RpcFetch;
  now?: () => number;
  accessKeys?: (accountId: string) => Promise<readonly string[]>;
}

export function createServerDeps(config: ServerDepsConfig): ServerDeps {
  const env = config.env ?? parseEnv();
  const now = config.now ?? Date.now;
  const oneClickFetch = config.oneClickFetch;

  const oneClick = createOneClickClient({
    baseUrl: env.ONECLICK_BASE_URL,
    jwt: env.ONECLICK_JWT,
    ...(oneClickFetch ? { fetchImpl: oneClickFetch } : {}),
  });

  const nearRpc: NearRpcConfig = {
    url: env.NEAR_RPC_URL ?? "",
    ...(config.nearFetch ? { fetchImpl: config.nearFetch } : {}),
  };

  const readAccessKeys =
    config.accessKeys ??
    (async (accountId: string) => {
      const keys = await getAccessKeys(nearRpc, accountId);
      return keys.map((key) => key.publicKey);
    });

  return {
    db: config.db,
    env,
    oneClick,
    tokens: createTokenRegistry({ client: oneClick, now }),
    sessions: createSessionCodec({
      secret: sessionSecretFrom(env.SESSION_SECRET),
      now,
    }),
    nonces: createNonceStore({ now }),
    quoteLimits: createRateLimiter({ ...QUOTE_LIMIT, now }),
    statusLimits: createRateLimiter({ ...STATUS_LIMIT, now }),
    nearRpc,
    usdcContractId: env.USDC_CONTRACT_ID ?? null,
    managerPublicKey: env.ONECLICK_MANAGER_PUBLIC_KEY ?? null,
    appUrl: env.PUBLIC_APP_URL,
    expectedRecipient: expectedRecipient({ PUBLIC_APP_URL: env.PUBLIC_APP_URL }),
    secureCookies: isSecurePublicUrl({ PUBLIC_APP_URL: env.PUBLIC_APP_URL }),
    now,
    accessKeys: readAccessKeys,
  };
}

let installed: ServerDeps | undefined;
let building: Promise<ServerDeps> | undefined;

/** Replace the process deps — what the route tests and demo mode use to install their own. */
export function installServerDeps(deps: ServerDeps): void {
  installed = deps;
  building = undefined;
}

/** The process deps, built from the environment and the configured database engine. */
export async function getServerDeps(): Promise<ServerDeps> {
  if (installed) return Promise.resolve(installed);
  building ??= getDatabase().then(({ db }) => {
    installed = createServerDeps({ db });
    return installed;
  });
  return building;
}

/** Forget the installed deps (test isolation; the next `getServerDeps()` rebuilds from scratch). */
export function clearServerDeps(): void {
  installed = undefined;
  building = undefined;
}
