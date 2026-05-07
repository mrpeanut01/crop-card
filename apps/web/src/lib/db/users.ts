/**
 * User repo. Phase 4 stops at a "system" user used for spray-record
 * authorship until Auth.js magic-link lands. The audit trail still records
 * who performed each action; today everything's the system user.
 */

import { eq } from 'drizzle-orm';
import { db } from './client';
import { users } from './schema';

const SYSTEM_USER_ID = 'system';

export async function ensureSystemUser(): Promise<{ id: string; email: string; role: string }> {
  const existing = db.select().from(users).where(eq(users.id, SYSTEM_USER_ID)).get();
  if (existing) return existing;
  const inserted = db
    .insert(users)
    .values({
      id: SYSTEM_USER_ID,
      email: 'system@cropcard.local',
      role: 'owner'
    })
    .returning()
    .get();
  return inserted;
}
