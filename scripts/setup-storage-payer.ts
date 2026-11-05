/**
 * Prepare the storage-payer account the app needs to register payout addresses (S0.10 / #13).
 * Roadmap: S0.10 · Spec: ARCHITECTURE.md §3.5, §8 · AGENTS.md §7
 *
 * It deliberately stops short of the two things an agent must not do: creating an account on someone's
 * behalf and moving funds. What it can do is generate the key locally, derive the NEAR implicit account
 * id it controls (an address that needs no creation step — tokens sent to it materialise the account),
 * write the secret into `.env` where the rules say keys live, and then confirm read-only that the human
 * has funded it. The private key is never printed, never echoed, and never leaves this file.
 *
 * Usage:
 *   pnpm payer              status + the steps to take
 *   pnpm payer:generate     new keypair -> `.env`, prints the address to fund
 *   pnpm payer:check        read-only: does that address exist on-chain yet, and with what balance
 */

import { existsSync, appendFileSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

import { implicitAccountFromPublicKey } from "../lib/near/implicit";
import { formatAmount, parseBaseUnits } from "../lib/core/money";
import { NEAR_DECIMALS } from "../lib/near/storage";
import { viewAccount, NearRpcError, type NearRpcConfig } from "../lib/near/rpc";

const ENV_FILE = join(process.cwd(), ".env");
const ACCOUNT_KEY = "STORAGE_PAYER_ACCOUNT_ID";
const SECRET_KEY = "STORAGE_PAYER_PRIVATE_KEY";

/** NEAR yoctoNEAR, for reading a balance a human sees in NEAR. */
const yocto = (value: string): string =>
  `${formatAmount(parseBaseUnits(value), NEAR_DECIMALS)} NEAR`;

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) out[match[1]] = match[2];
  }
  return out;
}

function value(name: string): string | undefined {
  const fromProcess = process.env[name];
  const text =
    fromProcess !== undefined && fromProcess.trim() !== "" ? fromProcess : readEnvFile()[name];
  return text !== undefined && text.trim() !== "" ? text.trim() : undefined;
}

function steps(address: string | null | undefined): void {
  console.log("");
  console.log(
    "This script signs nothing and sends nothing (AGENTS.md §7). The two steps below are yours.",
  );
  console.log("");
  console.log("  1. Send a small amount of NEAR to the payer address.");
  console.log(
    "     Any wallet or exchange withdrawal works; the account is created by the deposit itself.",
  );
  console.log(
    "     0.1 NEAR is a comfortable start: roughly 75 registrations at USDC-on-NEAR's ~0.00126 NEAR",
  );
  console.log(
    "     bond (an estimate — the app reads `storage_balance_bounds.min` from the contract), plus gas.",
  );
  console.log("");
  if (address) {
    console.log(`  2. Fund it:  ${address}`);
  } else {
    console.log(
      "  2. Nothing to fund yet — run `pnpm payer:generate` to create the key and the address.",
    );
  }
  console.log("");
  console.log(
    "  3. Confirm with `pnpm payer:check`. Once it reports a balance, S2.10 (#103) is unblocked",
  );
  console.log("     except for the send itself, which still needs an explicit yes in chat.");
}

function generate(): void {
  if (value(SECRET_KEY) !== undefined || value(ACCOUNT_KEY) !== undefined) {
    console.log(`Refusing to overwrite an existing ${ACCOUNT_KEY} / ${SECRET_KEY} in .env.`);
    console.log(
      "Remove those lines yourself first — a payer key is not something a script replaces silently.",
    );
    process.exit(1);
  }

  // 32 random bytes, then the public half appended: NEAR writes a private key as the 64-byte extended form.
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secret);
  const publicNear = `ed25519:${bs58.encode(publicKey)}`;
  const secretNear = `ed25519:${bs58.encode(new Uint8Array([...secret, ...publicKey]))}`;
  const accountId = implicitAccountFromPublicKey(publicNear);

  const creating = !existsSync(ENV_FILE);
  appendFileSync(
    ENV_FILE,
    `${creating ? "# Storage payer (S0.10) — never commit .env\n" : ""}${ACCOUNT_KEY}=${accountId}\n${SECRET_KEY}=${secretNear}\n`,
    {
      mode: 0o600,
    },
  );
  if (!creating) chmodSync(ENV_FILE, 0o600);

  console.log(
    "A keypair was generated locally and written to .env (0600). The secret is not printed here.",
  );
  console.log(`  public key   ${publicNear}`);
  console.log(`  ${ACCOUNT_KEY}=${accountId}`);
  console.log("");
  console.log(
    "If .env is synced or backed up anywhere, delete that line and generate again instead of funding it.",
  );
  steps(accountId);
}

async function check(): Promise<void> {
  const accountId = value(ACCOUNT_KEY);
  const rpcUrl = value("NEAR_RPC_URL");
  if (!accountId) {
    console.log(
      `No ${ACCOUNT_KEY} in the environment or .env — run \`pnpm payer:generate\` first.`,
    );
    process.exit(1);
  }
  if (!rpcUrl) {
    console.log(
      "NEAR_RPC_URL is unset, so the funding check cannot run. Set it and retry (read-only, no funds move).",
    );
    process.exit(1);
  }

  const config: NearRpcConfig = { url: rpcUrl };
  try {
    const account = await viewAccount(config, accountId);
    console.log(`Payer ${accountId.slice(0, 12)}… exists with ${yocto(account.amount ?? "0")}.`);
    console.log(
      `  access keys: ${account.access_keys.map((key) => key.public_key).join(", ") || "none"}`,
    );
    console.log("Ready for S2.10 (#103): the app can now pay storage bonds on a payout change.");
  } catch (error) {
    if (error instanceof NearRpcError && error.kind === "rpc_error") {
      console.log(`Payer ${accountId.slice(0, 12)}… does not exist yet — it is unfunded.`);
      steps(accountId);
      process.exit(1);
    }
    throw error;
  }
}

function status(): void {
  const accountId = value(ACCOUNT_KEY);
  const hasSecret = value(SECRET_KEY) !== undefined;

  console.log(
    "storage-payer (S0.10 / #13) — an implicit account, so no creation step, only funding",
  );
  if (accountId && hasSecret) {
    console.log(
      `  configured: ${ACCOUNT_KEY}=${accountId.slice(0, 12)}… and a private key in .env`,
    );
    console.log("  next: `pnpm payer:check` to confirm the deposit landed.");
    return;
  }
  console.log("  not configured.");
  steps(accountId);
}

const mode = process.argv[2];
if (mode === "generate") generate();
else if (mode === "check") await check();
else if (mode === undefined || mode === "status") status();
else {
  console.log(`Unknown mode "${mode}". Use: pnpm payer, pnpm payer:generate or pnpm payer:check`);
  process.exit(1);
}
