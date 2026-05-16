/**
 * Per-Owner app settings repo (Phase 18a).
 *
 * The legacy single-farm `appSettings` table used `key` as the PK; the
 * Phase 18a migration rebuilt it with composite `(owner_id, key)`. All
 * reads/writes here go through the tenant scope so two Owners can hold the
 * same key with different values.
 */

import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { appSettings } from './schema';
import { tenantValues, tenantWhere, requireOwnerId } from './tenant';

export function getSetting(key: string): string | undefined {
  return (
    db
      .select()
      .from(appSettings)
      .where(and(tenantWhere(appSettings), eq(appSettings.key, key)))
      .get()?.value ?? undefined
  );
}

export function setSetting(key: string, value: string): void {
  const ownerId = requireOwnerId();
  db.insert(appSettings)
    .values(tenantValues({ key, value, updatedAt: new Date(Date.now()) }))
    .onConflictDoUpdate({
      target: [appSettings.ownerId, appSettings.key],
      set: { value, updatedAt: new Date(Date.now()) }
    })
    .run();
  // Silence unused-import lint when ownerId isn't used elsewhere; the
  // assignment confirms a tenant context is bound before we write.
  void ownerId;
}

export function deleteSetting(key: string): void {
  db.delete(appSettings)
    .where(and(tenantWhere(appSettings), eq(appSettings.key, key)))
    .run();
}
