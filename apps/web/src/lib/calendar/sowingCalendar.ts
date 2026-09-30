/**
 * The printable sowing calendar (E3): one row per planting of a season, in
 * the /today Season view's order, with bars for indoor sowing, the
 * transplant or direct-sow date, and the planting window of an undated plan,
 * against the farm's frost lines (the range always holds them) and its
 * short-day band. Pure and
 * client-safe; the loader passes everything in.
 */

import type { CalendarEventKind } from './engine';
import { shortDaySpans, type ShortDays } from './persephone';

export type SowingBarKind = 'indoor-sow' | 'transplant' | 'direct-sow' | 'window';

export const SOWING_BAR_LABEL: Record<SowingBarKind, string> = {
  'indoor-sow': 'Sow indoors',
  transplant: 'Transplant',
  'direct-sow': 'Direct sow',
  window: 'Window'
};

export interface SowingBar {
  kind: SowingBarKind;
  startMs: number;
  endMs: number;
  /** Done and on record (solid), or planned (dashed). */
  recorded: boolean;
  label: string;
}

/** Per-bed frost after covers. Structurally a subset of E2's `EffectiveFrost`. */
export interface RowFrost {
  lastSpringFrostMs: number;
  firstFallFrostMs: number;
  frostFree: boolean;
  springShiftDays: number;
  fallShiftDays: number;
  unknownShift?: readonly string[];
}

export type RowNote =
  | { kind: 'heated' }
  | { kind: 'covered'; springMs: number | null; fallMs: number | null }
  | { kind: 'cover-unknown' };

export interface SowingRow {
  plantingId: string;
  name: string;
  blockId: string;
  blockName: string;
  plantingDate: number | null;
  bars: SowingBar[];
  note: RowNote | null;
}

export type FrostLineKind = 'last-spring' | 'first-fall' | 'hard-last-spring' | 'hard-first-fall';

export const FROST_LINE_LABEL: Record<FrostLineKind, string> = {
  'last-spring': 'Last spring frost',
  'first-fall': 'First fall frost',
  'hard-last-spring': 'Last hard frost',
  'hard-first-fall': 'First hard frost'
};

export interface FrostLine {
  kind: FrostLineKind;
  ms: number;
  provenance: 'data' | 'manual' | 'fallback';
}

export interface SowingPlantingIn {
  id: string;
  name: string;
  blockId: string;
  blockName: string;
  plantingDate: number | null;
  status: string;
}

export interface SowingEventIn {
  kind: CalendarEventKind;
  cropId?: string;
  startMs: number;
  endMs: number;
  title: string;
  detail?: Record<string, unknown>;
}

export interface SowingCalendarInput {
  year: number;
  now: number;
  /** The Season view's window; the calendar grows to hold every bar. */
  fromMs: number;
  toMs: number;
  /** Plantings in the Season view's row order. */
  plantings: readonly SowingPlantingIn[];
  /** Engine events built with `EventContext.seedStart`. */
  events: readonly SowingEventIn[];
  /** Planting window of each undated plan, by planting id. */
  windows: Readonly<Record<string, { startMs: number; endMs: number }>>;
  frostByBlock: Readonly<Record<string, RowFrost>>;
  frostLines: readonly FrostLine[];
  /** The farm's saved location, or null when none is saved. */
  latLon: { lat: number; lon: number } | null;
}

export interface SowingCalendar {
  year: number;
  fromMs: number;
  toMs: number;
  rows: SowingRow[];
  frostLines: FrostLine[];
  shortDays: ShortDays;
}

const SEED_KINDS: ReadonlySet<CalendarEventKind> = new Set([
  'indoor-sow',
  'transplant',
  'direct-sow'
]);

function rowNote(frost: RowFrost | undefined): RowNote | null {
  if (!frost) return null;
  if (frost.frostFree) return { kind: 'heated' };
  const spring = frost.springShiftDays > 0 ? frost.lastSpringFrostMs : null;
  const fall = frost.fallShiftDays > 0 ? frost.firstFallFrostMs : null;
  if (spring !== null || fall !== null) return { kind: 'covered', springMs: spring, fallMs: fall };
  if (frost.unknownShift && frost.unknownShift.length > 0) return { kind: 'cover-unknown' };
  return null;
}

/** The row's note in plain words, with `date` formatting a day. */
export function rowNoteText(note: RowNote, date: (ms: number) => string): string {
  switch (note.kind) {
    case 'heated':
      return 'Heated: no frost';
    case 'cover-unknown':
      return 'Covered: shift not known';
    case 'covered':
      if (note.springMs !== null && note.fallMs !== null) {
        return `Covered: frost from ${date(note.springMs)} to ${date(note.fallMs)}`;
      }
      if (note.springMs !== null) return `Covered: frost from ${date(note.springMs)}`;
      return `Covered: fall frost ${date(note.fallMs as number)}`;
  }
}

export function buildSowingCalendar(input: SowingCalendarInput): SowingCalendar {
  const rows: SowingRow[] = input.plantings.map((p) => {
    const bars: SowingBar[] = [];
    const planted =
      p.status !== 'planned' && p.plantingDate !== null && p.plantingDate <= input.now;
    for (const e of input.events) {
      if (e.cropId !== p.id || !SEED_KINDS.has(e.kind)) continue;
      const kind = e.kind as Exclude<SowingBarKind, 'window'>;
      const recorded = kind === 'indoor-sow' ? e.detail?.recorded === true : planted;
      bars.push({
        kind,
        startMs: e.startMs,
        endMs: Math.max(e.startMs, e.endMs),
        recorded,
        label: e.title
      });
    }
    const window = p.plantingDate === null ? input.windows[p.id] : undefined;
    if (window) {
      bars.push({
        kind: 'window',
        startMs: window.startMs,
        endMs: Math.max(window.startMs, window.endMs),
        recorded: false,
        label: SOWING_BAR_LABEL.window
      });
    }
    bars.sort((a, b) => a.startMs - b.startMs);
    return {
      plantingId: p.id,
      name: p.name,
      blockId: p.blockId,
      blockName: p.blockName,
      plantingDate: p.plantingDate,
      bars,
      note: rowNote(input.frostByBlock[p.blockId])
    };
  });

  const lineMs = input.frostLines.map((l) => l.ms);
  const starts = [input.fromMs, ...lineMs, ...rows.flatMap((r) => r.bars.map((b) => b.startMs))];
  const ends = [input.toMs, ...lineMs, ...rows.flatMap((r) => r.bars.map((b) => b.endMs))];
  const fromMs = Math.min(...starts);
  const toMs = Math.max(...ends);
  const frostLines = [...input.frostLines].sort((a, b) => a.ms - b.ms);
  return {
    year: input.year,
    fromMs,
    toMs,
    rows,
    frostLines,
    shortDays: shortDaySpans(input.latLon?.lat ?? null, input.latLon?.lon ?? null, fromMs, toMs)
  };
}
