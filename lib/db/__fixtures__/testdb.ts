/**
 * Test-only database helpers: an in-memory PGlite with the real migrations applied, and the
 * parent rows every child table needs.
 *
 * Roadmap: S2.9 · tests never touch a hosted database (AGENTS.md §8) — `memory://` keeps each
 * file's rows private, so a unique-index assertion cannot be polluted by an earlier run.
 */

import { createDatabase, type ConnectedDatabase, type PgliteDb } from "../client";
import type { InvoiceLineInput } from "../../core/types";
import { createInvoice, type CreateInvoiceInput, type InvoiceRecord } from "../queries/invoices";
import { setActiveDestination } from "../queries/payoutDestinations";
import { upsertUserByNearAccount } from "../queries/users";

export function openTestDatabase(): Promise<ConnectedDatabase<PgliteDb>> {
  return createDatabase({ dataDir: "memory://" });
}

/** Two lines that do not divide evenly, so a float in the total would show up immediately. */
export const LINES: readonly InvoiceLineInput[] = [
  { description: "Design, sprint 12", quantity: "1.5", unitPrice: "3333333" },
  { description: "Rush surcharge", quantity: "3", unitPrice: "1" },
];

let accountSequence = 0;

/** A distinct NEAR account id per call — `near_account_id` is unique. */
export function nextAccountId(prefix = "tester"): string {
  accountSequence += 1;
  return `${prefix}-${accountSequence}.testnet`;
}

export async function seedUser(db: PgliteDb, accountId = nextAccountId()) {
  return upsertUserByNearAccount(db, {
    nearAccountId: accountId,
    displayName: "Test Freelancer",
    email: `${accountId}@example.test`,
  });
}

export async function seedDestination(db: PgliteDb, userId: string) {
  return setActiveDestination(db, {
    userId,
    assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    chain: "near",
    address: "freelancer.testnet",
  });
}

/** The smallest set of rows a `payment_attempts` insert satisfies: user → destination → invoice. */
export async function seedInvoice(
  db: PgliteDb,
  overrides: Partial<CreateInvoiceInput> = {},
): Promise<{
  user: Awaited<ReturnType<typeof seedUser>>;
  destinationId: string;
  invoice: InvoiceRecord;
}> {
  const user = await seedUser(db);
  const destination = await seedDestination(db, user.id);
  const invoice = await createInvoice(db, {
    userId: user.id,
    clientName: "Client Co",
    lines: LINES,
    ...overrides,
  });
  return { user, destinationId: destination.id, invoice };
}
