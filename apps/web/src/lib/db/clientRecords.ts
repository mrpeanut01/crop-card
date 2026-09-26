import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { clientRecordReceipts } from './schema';
import { tenantValues, withTenant } from './tenant';

/** `claimed` carries a fencing token (the claim's `updated_at` in ms) that
 *  completion and release must present, so a slow request whose claim was
 *  taken over as stale cannot release or complete the new holder's claim. */
export type ClientRecordClaim =
  { status: 'claimed'; token: number } | { status: 'done' } | { status: 'pending' };

/** A `pending` claim older than this is treated as abandoned (a crashed
 *  request) so the record can still be saved. */
export const STALE_CLAIM_MS = 60_000;

function byId(clientRecordId: string) {
  return withTenant(clientRecordReceipts, eq(clientRecordReceipts.clientRecordId, clientRecordId));
}

function heldBy(clientRecordId: string, token: number) {
  return [
    eq(clientRecordReceipts.clientRecordId, clientRecordId),
    eq(clientRecordReceipts.status, 'pending'),
    eq(clientRecordReceipts.updatedAt, new Date(token))
  ];
}

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
  if (inserted.changes === 1) return { status: 'claimed', token: now };
  const where = byId(clientRecordId);
  const row = db.select().from(clientRecordReceipts).where(where).get();
  if (!row) return { status: 'pending' };
  if (row.status === 'done') return { status: 'done' };
  if (now - row.updatedAt.getTime() < STALE_CLAIM_MS) return { status: 'pending' };
  const taken = db
    .update(clientRecordReceipts)
    .set({ updatedAt: new Date(now) })
    .where(and(where, eq(clientRecordReceipts.updatedAt, row.updatedAt)))
    .run();
  return taken.changes === 1 ? { status: 'claimed', token: now } : { status: 'pending' };
}

/** The receipt's current status for this Owner, or null when none exists. */
export function clientRecordStatus(clientRecordId: string): 'done' | 'pending' | null {
  const row = db
    .select({ status: clientRecordReceipts.status })
    .from(clientRecordReceipts)
    .where(
      withTenant(clientRecordReceipts, eq(clientRecordReceipts.clientRecordId, clientRecordId))
    )
    .get();
  return row ? row.status : null;
}

/** Marks the record saved. Returns false when the claim behind `token` is no
 *  longer held, leaving the current holder's receipt untouched. */
export function completeClientRecord(
  clientRecordId: string,
  token: number,
  now: number = Date.now()
): boolean {
  const res = db
    .update(clientRecordReceipts)
    .set({ status: 'done', updatedAt: new Date(now) })
    .where(withTenant(clientRecordReceipts, ...heldBy(clientRecordId, token)))
    .run();
  return res.changes === 1;
}

/** Frees the claim behind `token` so a retry can save the record. Returns
 *  false when that claim is no longer held. */
export function releaseClientRecord(clientRecordId: string, token: number): boolean {
  const res = db
    .delete(clientRecordReceipts)
    .where(withTenant(clientRecordReceipts, ...heldBy(clientRecordId, token)))
    .run();
  return res.changes === 1;
}
