/**
 * Per-Owner app settings repo (Phase 18a).
 *
 * The legacy single-farm `appSettings` table used `key` as the PK; the
 * Phase 18a migration rebuilt it with composite `(owner_id, key)`. All
 * reads/writes here go through the tenant scope so two Owners can hold the
 * same key with different values.
 */

import { and, eq, inArray } from 'drizzle-orm';
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

/** Reads one setting; the default is `getSetting`, and a loader that
 *  fetched several keys at once with `getSettings` can pass its own. */
export type SettingReader = (key: string) => string | undefined;

/** Several settings in one read; keys with no row are left out. */
export function getSettings(keys: readonly string[]): Map<string, string> {
  if (keys.length === 0) return new Map();
  const rows = db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(tenantWhere(appSettings), inArray(appSettings.key, [...keys])))
    .all();
  return new Map(rows.flatMap((r) => (r.value == null ? [] : [[r.key, r.value] as const])));
}

/** A reader over the settings `keys`, fetched in one read. Keys outside the
 *  list fall through to `getSetting`. */
export function settingsReader(keys: readonly string[]): SettingReader {
  const saved = getSettings(keys);
  const known = new Set(keys);
  return (key) => (known.has(key) ? saved.get(key) : getSetting(key));
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
