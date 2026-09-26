import { eq } from 'drizzle-orm';
import { db } from './client';
import { clientRecordReceipts } from './schema';
import { tenantValues, withTenant } from './tenant';

export type ClientRecordClaim = 'claimed' | 'done' | 'pending';

/** A `pending` claim older than this is treated as abandoned (a crashed
 *  request) so the record can still be saved. */
export const STALE_CLAIM_MS = 60_000;

/** Claims a client record id for this Owner. `claimed` means the caller
 *  should save the record; `done` means it was already saved; `pending`
 *  means another request is saving it right now. */
export function claimClientRecord(
  clientRecordId: string,
  endpoint: string,
  now: number = Date.now()
): ClientRecordClaim {
  const inserted = db
    .insert(clientRecordReceipts)
    .values(
      tenantValues({
        clientRecordId,
        endpoint,
        status: 'pending' as const,
        updatedAt: new Date(now)
      })
    )
    .onConflictDoNothing()
    .run();
  if (inserted.changes === 1) return 'claimed';
  const where = withTenant(
    clientRecordReceipts,
    eq(clientRecordReceipts.clientRecordId, clientRecordId)
  );
  const row = db.select().from(clientRecordReceipts).where(where).get();
  if (!row) return 'claimed';
  if (row.status === 'done') return 'done';
  if (now - row.updatedAt.getTime() < STALE_CLAIM_MS) return 'pending';
  db.update(clientRecordReceipts)
    .set({ updatedAt: new Date(now) })
    .where(where)
    .run();
  return 'claimed';
}

export function completeClientRecord(clientRecordId: string, now: number = Date.now()): void {
  db.update(clientRecordReceipts)
    .set({ status: 'done', updatedAt: new Date(now) })
    .where(
      withTenant(clientRecordReceipts, eq(clientRecordReceipts.clientRecordId, clientRecordId))
    )
    .run();
}

export function releaseClientRecord(clientRecordId: string): void {
  db.delete(clientRecordReceipts)
    .where(
      withTenant(clientRecordReceipts, eq(clientRecordReceipts.clientRecordId, clientRecordId))
    )
    .run();
}
