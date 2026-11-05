/**
 * `users` queries.
 * Roadmap: S2.9 · Spec: ARCHITECTURE.md §4
 *
 * One row per NEAR account id, created or refreshed on every successful NEP-413 sign-in, which
 * is why the write is an upsert: a returning freelancer changes their display name and email, and
 * sign-in must never fail because the row already exists.
 */

import { eq } from "drizzle-orm";

import type { Database } from "../client";
import { users, type User } from "../schema";

export interface NewUserInput {
  nearAccountId: string;
  displayName: string;
  email?: string | null;
  /** Demo-mode rows are flagged so a real payout can never be pointed at one. */
  isDemo?: boolean;
}

/** Insert, or refresh the mutable fields of an existing account, and return the row. */
export async function upsertUserByNearAccount(db: Database, input: NewUserInput): Promise<User> {
  const rows = await db
    .insert(users)
    .values({
      nearAccountId: input.nearAccountId,
      displayName: input.displayName,
      email: input.email ?? null,
      isDemo: input.isDemo ?? false,
    })
    .onConflictDoUpdate({
      target: users.nearAccountId,
      set: { displayName: input.displayName, email: input.email ?? null },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error(`upsertUserByNearAccount returned no row for ${input.nearAccountId}`);
  return row;
}

export async function findUserById(db: Database, id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findUserByNearAccount(
  db: Database,
  nearAccountId: string,
): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.nearAccountId, nearAccountId)).limit(1);
  return rows[0] ?? null;
}
