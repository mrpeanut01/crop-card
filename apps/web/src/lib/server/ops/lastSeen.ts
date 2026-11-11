/**
 * `users.last_seen_at` for the operator usage report: written from
 * `revalidateCookieUser` at most once an hour per user, so a busy session
 * costs one extra write an hour. Always the real clock, so a demo farm's
 * shifted time never lands in it. A failed write (the deploy fence's
 * query_only, a busy database) is ignored: a missed touch only makes the
 * report undercount by one hour.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { realNow } from '$lib/server/clock';
import { isFenced } from '$lib/server/ops/handoff';

export const LAST_SEEN_INTERVAL_MS = 60 * 60 * 1000;

export function lastSeenIsStale(stored: Date | null, now: number): boolean {
  return !stored || now - stored.getTime() >= LAST_SEEN_INTERVAL_MS;
}

export function touchLastSeen(userId: string, stored: Date | null, now = realNow()): boolean {
  if (!lastSeenIsStale(stored, now) || isFenced()) return false;
  try {
    db.update(users)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(users.id, userId))
      .run();
    return true;
  } catch {
    return false;
  }
}
