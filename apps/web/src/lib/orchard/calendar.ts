/** The orchard calendar UI's pure rules (#562, docs/design/ORCHARD_CALENDAR.md
 *  rulings OC-3 to OC-7, OP-4, OP-8, OP-28 and the 562 panel). Client-safe:
 *  no database, no registry. Nothing here gates a record; the only path into
 *  a form is `bloomPrefillFromMarks`, which can only say `in-bloom`. */

import type { OrchardCalendarPlugin, OrchardStage, OrchardWindow } from '$lib/plugins/schemas';

export type CalendarAudience = 'commercial' | 'home';

/** Why the guide was picked, in OP-4 order. */
export type AudienceReason =
  'override' | 'garden-area' | 'greenhouse-area' | 'garden-profile' | 'no-profile' | 'farm-profile';

export interface AudienceChoice {
  audience: CalendarAudience;
  reason: AudienceReason;
  /** `manual` for the owner's per-Area choice, `data` for the farm's own
   *  answers (Area kind, farm profile). */
  provenance: 'manual' | 'data';
}

export const AUDIENCE_SETTING_PREFIX = 'orchard_calendar_audience.';

export function audienceSettingKey(areaId: string): string {
  return `${AUDIENCE_SETTING_PREFIX}${areaId}`;
}

export function parseAudience(raw: unknown): CalendarAudience | null {
  return raw === 'commercial' || raw === 'home' ? raw : null;
}

/** OP-4: (1) the owner's per-Area override, (2) a garden or greenhouse Area
 *  is home, (3) home when the farm profile is `garden` or unset, (4) else
 *  commercial. Season Setup philosophy never picks the guide. */
export function calendarAudienceFor(input: {
  override?: unknown;
  areaKind?: string | null;
  farmProfile?: string | null;
}): AudienceChoice {
  const override = parseAudience(input.override);
  if (override) return { audience: override, reason: 'override', provenance: 'manual' };
  if (input.areaKind === 'garden')
    return { audience: 'home', reason: 'garden-area', provenance: 'data' };
  if (input.areaKind === 'greenhouse')
    return { audience: 'home', reason: 'greenhouse-area', provenance: 'data' };
  if (input.farmProfile === 'garden')
    return { audience: 'home', reason: 'garden-profile', provenance: 'data' };
  if (input.farmProfile !== 'farm' && input.farmProfile !== 'mixed')
    return { audience: 'home', reason: 'no-profile', provenance: 'data' };
  return { audience: 'commercial', reason: 'farm-profile', provenance: 'data' };
}

/** OP-3: one calendar per (crop, audience) after the loader's conflict pass. */
export function calendarFor(
  calendars: readonly OrchardCalendarPlugin[],
  cropPluginId: string,
  audience: CalendarAudience
): OrchardCalendarPlugin | null {
  return (
    calendars.find((c) => c.audience === audience && c.hostCropPluginIds.includes(cropPluginId)) ??
    null
  );
}

/** Crops that show "No seasonal calendar for this crop yet" when they have
 *  none (OC-6 as ruled for #562, OR-4): tree fruit, nuts and citrus in the
 *  `orchard` and `stone-fruit` families except never-harvested rootstocks,
 *  plus the grapes and blueberries OC-6 names. */
export function wantsSeasonalCalendar(crop: {
  pluginId: string;
  cropFamily?: string | null;
}): boolean {
  if (crop.pluginId.startsWith('rootstock-')) return false;
  if (crop.cropFamily === 'orchard' || crop.cropFamily === 'stone-fruit') return true;
  return crop.pluginId.startsWith('grape-') || crop.pluginId.startsWith('blueberry-');
}

export type CalendarStatus =
  | { kind: 'calendar'; calendar: OrchardCalendarPlugin }
  | { kind: 'out-of-date' }
  | { kind: 'none' };

/** Which calendar line a crop gets. A calendar the loader dropped (expired
 *  edition or refused) reads out of date and never falls back to another
 *  edition's text (OP-28). */
export function calendarStatusFor(
  calendars: readonly OrchardCalendarPlugin[],
  dropped: readonly { audience: string | null; hostCropPluginIds: readonly string[] }[],
  cropPluginId: string,
  audience: CalendarAudience
): CalendarStatus {
  const calendar = calendarFor(calendars, cropPluginId, audience);
  if (calendar) return { kind: 'calendar', calendar };
  const wasDropped = dropped.some(
    (d) =>
      (d.audience === null || d.audience === audience) && d.hostCropPluginIds.includes(cropPluginId)
  );
  return wasDropped ? { kind: 'out-of-date' } : { kind: 'none' };
}

/** OC-4/OP-4: under an organic philosophy or a `minimal` pest strategy the
 *  commercial calendar shows only these purposes. */
export const LOW_INPUT_PURPOSES: ReadonlySet<OrchardWindow['purpose']> = new Set([
  'scout',
  'cultural',
  'sanitation',
  'bloom',
  'harvest-prep'
]);

export function lowInputSeason(setup: { philosophy?: string; pestStrategy?: string } | null) {
  if (!setup) return false;
  return (
    setup.philosophy === 'organic-transitioning' ||
    setup.philosophy === 'certified-organic' ||
    setup.pestStrategy === 'minimal'
  );
}

export function shownWindows(
  calendar: Pick<OrchardCalendarPlugin, 'audience'>,
  stage: Pick<OrchardStage, 'windows'>,
  lowInput: boolean
): OrchardWindow[] {
  if (calendar.audience !== 'commercial' || !lowInput) return [...stage.windows];
  return stage.windows.filter((w) => LOW_INPUT_PURPOSES.has(w.purpose));
}

/** OP-8: "Check the label." shows on commercial risk windows only. */
export function showsLabelLine(
  calendar: Pick<OrchardCalendarPlugin, 'audience'>,
  window: Pick<OrchardWindow, 'purpose'>
): boolean {
  return (
    calendar.audience === 'commercial' &&
    (window.purpose === 'disease-risk' || window.purpose === 'pest-risk')
  );
}

// ─── Stage marks (OC-3, design "How the stage is known at runtime") ─────

export const STAGE_MARK_PREFIX = 'orchard_stage.';

export function stageMarkKey(blockId: string, year: number): string {
  return `${STAGE_MARK_PREFIX}${blockId}.${year}`;
}

export interface StageMark {
  stageId: string;
  markedAt: number;
  markedBy: string;
}

/** Stored as `{ [calendarPluginId]: StageMark }`. Anything malformed is
 *  dropped, so a damaged setting reads as no mark. */
export function parseStageMarks(raw: unknown): Record<string, StageMark> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, StageMark> = {};
  for (const [calendarId, m] of Object.entries(value as Record<string, unknown>)) {
    if (!m || typeof m !== 'object') continue;
    const { stageId, markedAt, markedBy } = m as Record<string, unknown>;
    if (
      typeof stageId === 'string' &&
      stageId.length > 0 &&
      typeof markedAt === 'number' &&
      Number.isFinite(markedAt) &&
      typeof markedBy === 'string'
    ) {
      out[calendarId] = { stageId, markedAt, markedBy };
    }
  }
  return out;
}

/** The stage ids whose mark pre-fills the insecticide form's bloom answer
 *  (OC-3: "a marked pink or bloom stage"). Pear's `white-bud` is the stage
 *  in its place in the pear calendar: blossom buds white and separated,
 *  just before they open. Petal fall is left out. */
export const BLOOM_PREFILL_STAGE_IDS: ReadonlySet<string> = new Set(['pink', 'white-bud', 'bloom']);

export interface BloomPrefill {
  /** The only answer a calendar may ever give (OC-3). */
  status: 'in-bloom';
  stageId: string;
  calendarId: string;
  markedAt: number;
}

/** The newest pink or bloom mark among a block's marks for this year, or
 *  null. Its type can only say `in-bloom`; no input ever produces
 *  `not-in-bloom`. */
export function bloomPrefillFromMarks(marks: unknown): BloomPrefill | null {
  const parsed = parseStageMarks(marks);
  let best: BloomPrefill | null = null;
  for (const [calendarId, m] of Object.entries(parsed)) {
    if (!BLOOM_PREFILL_STAGE_IDS.has(m.stageId)) continue;
    if (!best || m.markedAt > best.markedAt) {
      best = { status: 'in-bloom', stageId: m.stageId, calendarId, markedAt: m.markedAt };
    }
  }
  return best;
}

/** The form's starting answer: `in-bloom` when a crop bloom window or a
 *  stage mark says so, else `unknown`, which the kernel treats as possibly
 *  in bloom. Never `not-in-bloom`. */
export function prefillBloomStatus(input: {
  bloomWindowSaysBlooming: boolean;
  stageMark: BloomPrefill | null | undefined;
}): 'in-bloom' | 'unknown' {
  return input.bloomWindowSaysBlooming || input.stageMark?.status === 'in-bloom'
    ? 'in-bloom'
    : 'unknown';
}

// ─── Schedule a scouting task (OC-7) ────────────────────────────────────

export function scoutTaskCategory(window: Pick<OrchardWindow, 'purpose'>): 'scout' | 'prune' {
  return window.purpose === 'cultural' || window.purpose === 'sanitation' ? 'prune' : 'scout';
}

export function scoutTaskTemplateKey(
  calendarId: string,
  windowId: string,
  blockId: string,
  year: number
): string {
  return `derived:orchard-window:${calendarId}:${windowId}:${blockId}:${year}`;
}

const SCOUT_KEY = /^derived:orchard-window:([^:]+):([^:]+):[^:]+:\d{4}$/;

export function parseScoutTaskKey(
  key: string | null | undefined
): { calendarId: string; windowId: string } | null {
  const m = key ? SCOUT_KEY.exec(key) : null;
  return m ? { calendarId: m[1], windowId: m[2] } : null;
}

/** At most this many target names in a task title, then "+N". */
export const SCOUT_TITLE_TARGETS = 3;

/** The task's title parts: weather targets are left out of the title, the
 *  rest are cut to `SCOUT_TITLE_TARGETS` plus a count. With no named pest or
 *  disease the title names the stage instead. */
export function scoutTitleParts(window: Pick<OrchardWindow, 'targets'>): {
  targetIds: string[];
  more: number;
} {
  const ids = window.targets.filter((t) => t.kind !== 'weather').map((t) => t.id);
  return {
    targetIds: ids.slice(0, SCOUT_TITLE_TARGETS),
    more: Math.max(0, ids.length - SCOUT_TITLE_TARGETS)
  };
}
