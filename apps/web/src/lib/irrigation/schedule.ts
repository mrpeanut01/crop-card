/**
 * Automatic waterer runs (Phase 37E, R-12). Pure and client-safe. A timer's
 * weekly program expands into run start instants in the farm's time zone;
 * each past run that was not skipped counts as a watering tagged `manual`
 * (the owner's schedule, assumed to have run). Future runs are display only.
 * The app never talks to a timer.
 */

import { dateTimeFormat } from '$lib/intlCache';
import type { WaterLog } from '$lib/weather/waterBalance';
import {
  isCalendarDay,
  storedScheduleSchema,
  type IrrigationSchedule,
  type StoredSchedule
} from './apiSchemas';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface WatererTarget {
  fieldId: string;
  /** Null covers the whole Area. */
  blockId: string | null;
  /** The owner's whole-percent share of a run's gallons (FU870-1). */
  sharePct?: number | null;
  /** The target's own size in square feet: the bed for a bed, the Area for
   *  a whole Area. Null or unset when it has none. */
  sqFt?: number | null;
  /** The Area the bed lies in now (a bed can move); unset uses `fieldId`. */
  blockFieldId?: string | null;
}

export interface Waterer {
  equipmentId: string;
  label: string;
  schedule: StoredSchedule;
  targets: readonly WatererTarget[];
}

/** The stored schedule in an equipment spec, or null when there is none or
 *  it no longer validates. */
export function scheduleOf(
  spec: Record<string, unknown> | null | undefined
): StoredSchedule | null {
  const parsed = storedScheduleSchema.safeParse(spec?.schedule);
  return parsed.success ? parsed.data : null;
}

/** True when two programs run the same way (the server keeps `activeFrom`). */
export function sameProgram(a: IrrigationSchedule, b: IrrigationSchedule): boolean {
  const days = (s: IrrigationSchedule) => [...s.days].sort().join(',');
  return (
    days(a) === days(b) &&
    a.start === b.start &&
    a.minutes === b.minutes &&
    a.method === b.method &&
    (a.inchesPerRun ?? null) === (b.inchesPerRun ?? null) &&
    (a.gallonsPerMinute ?? null) === (b.gallonsPerMinute ?? null)
  );
}

interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

function wallOf(ms: number, timeZone: string): Wall {
  const parts = dateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

function offsetMs(ms: number, timeZone: string): number {
  const w = wallOf(ms, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm) - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** The instant a wall-clock minute on (y, m, d) happens in `timeZone`. In a
 *  repeated hour (fall back) the earlier instant wins; a time skipped by a
 *  spring-forward change lands that much later. */
export function zonedWallMs(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  timeZone: string
): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMs(wall - 14 * 3_600_000, timeZone);
  const after = offsetMs(wall + 14 * 3_600_000, timeZone);
  const matches = [wall - before, wall - after].filter((t) => {
    const w = wallOf(t, timeZone);
    return w.y === y && w.m === m && w.d === d && w.hh === hh && w.mm === mm;
  });
  if (matches.length > 0) return Math.min(...matches);
  return wall - before;
}

function parseStart(start: string): { hh: number; mm: number } {
  const [hh, mm] = start.split(':').map(Number);
  return { hh: hh ?? 0, mm: mm ?? 0 };
}

/** The first instant a run can count from: the start of the owner's
 *  "running since" day in the farm zone when it is set (FU870-4), else the
 *  moment the schedule was set up. Undefined counts every run. */
export function countsFromMs(
  schedule: { activeFrom?: number; runningSince?: string | null },
  timeZone: string
): number | undefined {
  const since = schedule.runningSince;
  if (since && isCalendarDay(since)) {
    const [y, m, d] = since.split('-').map(Number);
    return zonedWallMs(y, m, d, 0, 0, timeZone);
  }
  return schedule.activeFrom;
}

/** Run start instants inside [fromMs, toMs), oldest first, never before
 *  `countsFromMs` (the owner's "running since" day, else `activeFrom`). */
export function expandRuns(
  schedule: Pick<StoredSchedule, 'days' | 'start'> & {
    activeFrom?: number;
    runningSince?: string | null;
  },
  opts: { fromMs: number; toMs: number; timeZone: string }
): number[] {
  if (!(opts.toMs > opts.fromMs)) return [];
  const countsFrom = countsFromMs(schedule, opts.timeZone);
  const days = new Set(schedule.days);
  const { hh, mm } = parseStart(schedule.start);
  const first = wallOf(opts.fromMs - DAY_MS, opts.timeZone);
  const last = wallOf(opts.toMs + DAY_MS, opts.timeZone);
  const lastDay = Date.UTC(last.y, last.m - 1, last.d);
  const out: number[] = [];
  for (let day = Date.UTC(first.y, first.m - 1, first.d); day <= lastDay; day += DAY_MS) {
    const date = new Date(day);
    if (!days.has(date.getUTCDay())) continue;
    const t = zonedWallMs(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hh,
      mm,
      opts.timeZone
    );
    if (t < opts.fromMs || t >= opts.toMs) continue;
    if (countsFrom !== undefined && t < countsFrom) continue;
    if (out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/** Runs the owner or a helper said did not water are dropped. */
export function withoutSkipped(runs: readonly number[], skippedAt: Iterable<number>): number[] {
  const skipped = new Set(skippedAt);
  return runs.filter((t) => !skipped.has(t));
}

/** Gallons one run gives in all, when the owner typed gallons per minute. */
export function runGallons(w: Pick<Waterer, 'schedule'>): number | null {
  const gpm = w.schedule.gallonsPerMinute;
  if (gpm === null || gpm === undefined) return null;
  return gpm * w.schedule.minutes;
}

export type GallonsSplitSource = 'single' | 'typed' | 'size';
export type GallonsSplitUnknown = 'no-size' | 'overlap' | 'shares';

/** Each target's fraction of a run's gallons, in target order. */
export type GallonsSplit =
  | { known: true; fractions: number[]; source: GallonsSplitSource }
  | { known: false; reason: GallonsSplitUnknown };

const validShare = (p: number | null | undefined): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 100;

/** A bed listed with an Area that this timer also waters whole, or a target
 *  listed twice. */
export function targetsOverlap(targets: readonly WatererTarget[]): boolean {
  const whole = new Set<string>();
  const seen = new Set<string>();
  for (const t of targets) {
    const key = `${t.fieldId}|${t.blockId ?? ''}`;
    if (seen.has(key)) return true;
    seen.add(key);
    if (t.blockId === null) whole.add(t.fieldId);
  }
  return targets.some((t) => t.blockId !== null && whole.has(t.blockFieldId ?? t.fieldId));
}

/** How a run's gallons split across a timer's targets (FU870-1). One target
 *  takes them all. With more, the owner's typed shares win when every
 *  target has one and they total 100; any typed share that does not make a
 *  full set leaves the split not known. Otherwise each target's share is
 *  its size over the targets' total, known only when every target has a
 *  size and no bed lies inside an Area the timer also waters whole. Never
 *  an even split by default. */
export function gallonsSplit(targets: readonly WatererTarget[]): GallonsSplit {
  if (targets.length === 1) return { known: true, fractions: [1], source: 'single' };
  if (targets.length === 0) return { known: false, reason: 'no-size' };
  const typed = targets.map((t) => t.sharePct);
  if (typed.some((p) => p !== null && p !== undefined)) {
    const total = typed.reduce<number>((sum, p) => sum + (validShare(p) ? p : 0), 0);
    if (!typed.every(validShare) || total !== 100) return { known: false, reason: 'shares' };
    return { known: true, fractions: typed.map((p) => (p as number) / 100), source: 'typed' };
  }
  if (targetsOverlap(targets)) return { known: false, reason: 'overlap' };
  const sizes = targets.map((t) => t.sqFt);
  if (!sizes.every((s): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0)) {
    return { known: false, reason: 'no-size' };
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  return { known: true, fractions: sizes.map((s) => s / total), source: 'size' };
}

/** Gallons each target gets from one run, in target order; null where the
 *  gallons or the split are not known. */
export function targetGallons(w: Pick<Waterer, 'schedule' | 'targets'>): Array<number | null> {
  const total = runGallons(w);
  if (total === null) return w.targets.map(() => null);
  const split = gallonsSplit(w.targets);
  if (!split.known) return w.targets.map(() => null);
  return split.fractions.map((f) => (f === 1 ? total : total * f));
}

/** The amount a run puts down when the owner typed it; null otherwise. */
export function runInches(w: Waterer): number | null {
  return w.schedule.inchesPerRun ?? null;
}

/** Each past run as a watering on every target of `fieldId`, tagged
 *  `manual` (R-12) whatever the split; the amount stays unknown when the
 *  schedule has none, and gallons go to each target by `targetGallons`. */
export function timerLogs(
  w: Waterer,
  runs: readonly number[],
  fieldId: string,
  nowMs: number
): WaterLog[] {
  const inches = runInches(w);
  const perTarget = inches === null ? targetGallons(w) : w.targets.map(() => null);
  const targets = w.targets.flatMap((target, i) =>
    target.fieldId === fieldId ? [{ target, gallons: perTarget[i] ?? null }] : []
  );
  return runs
    .filter((t) => t <= nowMs)
    .flatMap((t) =>
      targets.map(({ target, gallons }) => ({
        occurredAtMs: t,
        blockId: target.blockId,
        inches,
        gallons,
        durationMin: w.schedule.minutes,
        provenance: 'manual' as const,
        timer: { equipmentId: w.equipmentId, label: w.label }
      }))
    );
}

/** The next run at or after `nowMs` that was not skipped, within a week. */
export function nextRun(
  w: Waterer,
  opts: { nowMs: number; timeZone: string; skippedAt: Iterable<number> }
): number | null {
  const runs = withoutSkipped(
    expandRuns(w.schedule, {
      fromMs: opts.nowMs,
      toMs: opts.nowMs + 8 * DAY_MS,
      timeZone: opts.timeZone
    }),
    opts.skippedAt
  );
  return runs[0] ?? null;
}
