/**
 * Grower-entered trap-catch biofix dates, one per pest model and year, kept
 * in the per-Owner app settings under `pest_biofix.<modelId>.<year>`.
 */

import { and, like } from 'drizzle-orm';
import { db } from './client';
import { appSettings } from './schema';
import { deleteSetting, setSetting } from './settings';
import { tenantWhere } from './tenant';
import {
  BIOFIX_SETTING_PREFIX,
  biofixSettingKey,
  parseStoredBiofix,
  type StoredBiofix
} from '$lib/ipm/pestModels';

/** Every stored biofix for a year, keyed by model id. One query. */
export function listBiofixes(year: number): Map<string, StoredBiofix> {
  const suffix = `.${year}`;
  const rows = db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(tenantWhere(appSettings), like(appSettings.key, `${BIOFIX_SETTING_PREFIX}%`)))
    .all();
  const out = new Map<string, StoredBiofix>();
  for (const r of rows) {
    if (!r.key.startsWith(BIOFIX_SETTING_PREFIX) || !r.key.endsWith(suffix)) continue;
    const modelId = r.key.slice(BIOFIX_SETTING_PREFIX.length, -suffix.length);
    const parsed = parseStoredBiofix(r.value);
    if (modelId && parsed) out.set(modelId, parsed);
  }
  return out;
}

export function setBiofix(modelId: string, year: number, value: StoredBiofix): void {
  setSetting(biofixSettingKey(modelId, year), JSON.stringify(value));
}

export function clearBiofix(modelId: string, year: number): void {
  deleteSetting(biofixSettingKey(modelId, year));
}
