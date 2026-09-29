/**
 * C-35 §5: the audit row of an owner void that shortened a hold. Written
 * by the hold guard in the void's own transaction; never edited.
 */

import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from './client';
import { holdCorrections } from './schema';
import { tenantValues, withTenant } from './tenant';

export interface HoldCorrection {
  id: string;
  recordKind: string;
  recordId: string;
  userId: string | null;
  reason: string;
  diffJson: string;
  diffHash: string;
  createdAt: number;
}

export function insertHoldCorrection(input: Omit<HoldCorrection, 'id'>): HoldCorrection {
  const row = db
    .insert(holdCorrections)
    .values(
      tenantValues({
        id: randomUUID(),
        recordKind: input.recordKind,
        recordId: input.recordId,
        userId: input.userId,
        reason: input.reason,
        diffJson: input.diffJson,
        diffHash: input.diffHash,
        createdAt: new Date(input.createdAt)
      })
    )
    .returning()
    .get();
  return { ...row, userId: row.userId ?? null, createdAt: row.createdAt.getTime() };
}

/** The corrections on one record, newest first ("Owner-corrected"). */
export function listHoldCorrections(recordId?: string): HoldCorrection[] {
  return db
    .select()
    .from(holdCorrections)
    .where(
      withTenant(holdCorrections, recordId ? eq(holdCorrections.recordId, recordId) : undefined)
    )
    .orderBy(desc(holdCorrections.createdAt))
    .all()
    .map((row) => ({ ...row, userId: row.userId ?? null, createdAt: row.createdAt.getTime() }));
}
