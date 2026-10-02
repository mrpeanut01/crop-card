import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';

/** The active farm's name for an export's header. */
export function farmNameOf(ownerId: string | null): string {
  if (!ownerId) return '(unknown farm)';
  unscopedQueryNote('export headers look up the active Owner row for display');
  const row = db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get();
  return row?.name ?? '(unknown farm)';
}
