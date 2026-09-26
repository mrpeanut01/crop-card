/**
 * First-use hint state (Phase 30). Per user, not per Owner: someone learns a
 * control once, on whichever farm they meet it. Holds no farm data.
 */

import { and, count, eq } from 'drizzle-orm';
import { db } from './client';
import { userHints } from './schema';
import { unscopedQueryNote } from './tenant';
import { MAX_HINTS_PER_USER } from '$lib/hints';

export interface SeenHint {
  key: string;
  seenAt: number;
}

export function listSeen(userId: string): SeenHint[] {
  unscopedQueryNote('per-user UI hint state');
  return db
    .select({ key: userHints.hintKey, seenAt: userHints.seenAt })
    .from(userHints)
    .where(eq(userHints.userId, userId))
    .all()
    .map((r) => ({ key: r.key, seenAt: r.seenAt.getTime() }))
    .sort((a, b) => a.seenAt - b.seenAt || a.key.localeCompare(b.key));
}

/** Records a hint as seen. Idempotent: the first `seenAt` is kept. Returns
 *  false only when the per-user cap is reached for a new key. */
export function markSeen(userId: string, key: string, at: Date = new Date()): boolean {
  unscopedQueryNote('per-user UI hint state');
  const existing = db
    .select({ key: userHints.hintKey })
    .from(userHints)
    .where(and(eq(userHints.userId, userId), eq(userHints.hintKey, key)))
    .get();
  if (existing) return true;
  const total =
    db.select({ n: count() }).from(userHints).where(eq(userHints.userId, userId)).get()?.n ?? 0;
  if (total >= MAX_HINTS_PER_USER) return false;
  db.insert(userHints).values({ userId, hintKey: key, seenAt: at }).onConflictDoNothing().run();
  return true;
}
