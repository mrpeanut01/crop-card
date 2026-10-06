/**
 * Orchard calendar settings (#562), kept in the per-Owner app settings like
 * `pest_biofix.*`: the owner's guide choice per Area
 * (`orchard_calendar_audience.<areaId>`, OP-4) and the stage marks per block
 * and year (`orchard_stage.<blockId>.<year>`, OC-3). Wiped with the farm
 * like every other setting.
 */

import { and, like } from 'drizzle-orm';
import { db } from './client';
import { appSettings } from './schema';
import { deleteSetting, getSetting, setSetting } from './settings';
import { tenantWhere } from './tenant';
import {
  AUDIENCE_SETTING_PREFIX,
  STAGE_MARK_PREFIX,
  audienceSettingKey,
  parseAudience,
  parseStageMarks,
  stageMarkKey,
  type CalendarAudience,
  type StageMark
} from '$lib/orchard/calendar';

export function getAudienceOverride(areaId: string): CalendarAudience | null {
  return parseAudience(getSetting(audienceSettingKey(areaId)));
}

export function setAudienceOverride(areaId: string, audience: CalendarAudience | null): void {
  if (audience === null) deleteSetting(audienceSettingKey(areaId));
  else setSetting(audienceSettingKey(areaId), audience);
}

/** Every Area with an owner's guide choice. One query. */
export function listAudienceOverrides(): Map<string, CalendarAudience> {
  const rows = db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(tenantWhere(appSettings), like(appSettings.key, `${AUDIENCE_SETTING_PREFIX}%`)))
    .all();
  const out = new Map<string, CalendarAudience>();
  for (const r of rows) {
    const audience = parseAudience(r.value);
    const areaId = r.key.slice(AUDIENCE_SETTING_PREFIX.length);
    if (audience && areaId) out.set(areaId, audience);
  }
  return out;
}

export function getStageMarks(blockId: string, year: number): Record<string, StageMark> {
  return parseStageMarks(getSetting(stageMarkKey(blockId, year)));
}

export function setStageMark(
  blockId: string,
  year: number,
  calendarId: string,
  mark: StageMark | null
): void {
  const marks = getStageMarks(blockId, year);
  if (mark) marks[calendarId] = mark;
  else delete marks[calendarId];
  const key = stageMarkKey(blockId, year);
  if (Object.keys(marks).length === 0) deleteSetting(key);
  else setSetting(key, JSON.stringify(marks));
}

/** Every block's marks for a year, keyed by block id. One query. */
export function listStageMarks(year: number): Map<string, Record<string, StageMark>> {
  const suffix = `.${year}`;
  const rows = db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(tenantWhere(appSettings), like(appSettings.key, `${STAGE_MARK_PREFIX}%`)))
    .all();
  const out = new Map<string, Record<string, StageMark>>();
  for (const r of rows) {
    if (!r.key.endsWith(suffix)) continue;
    const blockId = r.key.slice(STAGE_MARK_PREFIX.length, -suffix.length);
    if (!blockId) continue;
    const marks = parseStageMarks(r.value);
    if (Object.keys(marks).length) out.set(blockId, marks);
  }
  return out;
}
