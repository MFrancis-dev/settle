/**
 * `payout_destinations` queries.
 * Roadmap: S2.9 · Spec: ARCHITECTURE.md §4, §5
 *
 * The table keeps history, so "the freelancer's payout address" means the single row with
 * `active = true`. Changing it deactivates the old row and inserts a new one inside one
 * transaction: two active rows would let a payment attempt snapshot the wrong address, and the
 * address a quote was built against can never be edited after the fact.
 *
 * Callers validate the address with `lib/core/address.ts` *before* writing — a stored bad
 * address means a real payment goes nowhere.
 */

import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { payoutDestinations, type PayoutDestinationRow } from "../schema";

export interface NewDestinationInput {
  userId: string;
  assetId: string;
  chain: string;
  address: string;
}

export async function getActiveDestination(
  db: Database,
  userId: string,
): Promise<PayoutDestinationRow | null> {
  const rows = await db
    .select()
    .from(payoutDestinations)
    .where(and(eq(payoutDestinations.userId, userId), eq(payoutDestinations.active, true)))
    .orderBy(desc(payoutDestinations.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findDestinationById(
  db: Database,
  id: string,
): Promise<PayoutDestinationRow | null> {
  const rows = await db.select().from(payoutDestinations).where(eq(payoutDestinations.id, id));
  return rows[0] ?? null;
}

export async function listDestinations(
  db: Database,
  userId: string,
): Promise<readonly PayoutDestinationRow[]> {
  return db
    .select()
    .from(payoutDestinations)
    .where(eq(payoutDestinations.userId, userId))
    .orderBy(desc(payoutDestinations.createdAt));
}

/**
 * Point a user at a new address, keeping the previous rows as history.
 * Returns the new active row. Re-setting the address that is already active is a no-op that
 * still returns it, so the API can answer 200 without writing a duplicate generation.
 */
export async function setActiveDestination(
  db: Database,
  input: NewDestinationInput,
): Promise<PayoutDestinationRow> {
  const current = await getActiveDestination(db, input.userId);
  if (
    current &&
    current.address === input.address &&
    current.assetId === input.assetId &&
    current.chain === input.chain
  ) {
    return current;
  }

  return db.transaction(async (tx) => {
    if (current) {
      await tx
        .update(payoutDestinations)
        .set({ active: false, deactivatedAt: new Date() })
        .where(eq(payoutDestinations.id, current.id));
    }

    const inserted = await tx
      .insert(payoutDestinations)
      .values({
        userId: input.userId,
        assetId: input.assetId,
        chain: input.chain,
        address: input.address,
        active: true,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error("setActiveDestination inserted no row");
    return row;
  });
}
