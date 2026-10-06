/** Display-only orchard calendar text (OP-29, docs/design/ORCHARD_CALENDAR.md).
 *  Calendar plugins are English data. The catalog keys their text by id:
 *  stage names and target labels are shared, stage descriptions and window
 *  notes are per calendar. A plugin's own text shows in the viewer's
 *  language only while it still equals the catalog's English, so a new
 *  edition reads in its own English until it is translated. Target labels
 *  are app-owned (plugins carry only ids). */

import { t, type MessageKey } from '$lib/i18n';
import { en } from './catalogs/en';

const SHIPPED = en as Record<string, string | undefined>;

function shown(key: string, text: string, locale: string | null | undefined): string {
  if (SHIPPED[key] === undefined || SHIPPED[key] !== text) return text;
  if (!locale || locale === 'en') return text;
  return t(locale, key as MessageKey);
}

export function orchardStageNameKey(calendarId: string, stageId: string, name: string): string {
  const own = `orchard.cal.${calendarId}.stage.${stageId}.name`;
  return SHIPPED[own] === name ? own : `orchard.stage.${stageId}`;
}

export function orchardStageName(
  calendarId: string,
  stage: { id: string; name: string },
  locale?: string | null
): string {
  return shown(orchardStageNameKey(calendarId, stage.id, stage.name), stage.name, locale);
}

export function orchardDescriptionKey(calendarId: string, stageId: string): string {
  return `orchard.cal.${calendarId}.stage.${stageId}.description`;
}

export function orchardStageDescription(
  calendarId: string,
  stage: { id: string; recognise: { description: string } },
  locale?: string | null
): string {
  return shown(orchardDescriptionKey(calendarId, stage.id), stage.recognise.description, locale);
}

export function orchardNoteKey(calendarId: string, windowId: string): string {
  return `orchard.cal.${calendarId}.window.${windowId}.note`;
}

export function orchardWindowNote(
  calendarId: string,
  window: { id: string; note?: string },
  locale?: string | null
): string | undefined {
  if (!window.note) return undefined;
  return shown(orchardNoteKey(calendarId, window.id), window.note, locale);
}

export function orchardTargetKey(targetId: string): string {
  return `orchard.target.${targetId}`;
}

/** A target's label; an id the catalog does not know reads as its words. */
export function orchardTargetLabel(targetId: string, locale?: string | null): string {
  const key = orchardTargetKey(targetId);
  if (SHIPPED[key] === undefined) return targetId.replace(/-/g, ' ');
  return t(locale ?? 'en', key as MessageKey);
}
