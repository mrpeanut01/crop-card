/**
 * Automatic waterer runs (Phase 37E, R-12). Pure and client-safe. A timer's
 * weekly program expands into run start instants in the farm's time zone;
 * each past run that was not skipped counts as a watering tagged `manual`
 * (the owner's schedule, assumed to have run). Future runs are display only.
 * The app never talks to a timer.
 */

import { dateTimeFormat } from '$lib/intlCache';
import type { WaterLog } from '$lib/weather/waterBalance';
import { storedScheduleSchema, type IrrigationSchedule, type StoredSchedule } from './apiSchemas';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface WatererTarget {
  fieldId: string;
  /** Null covers the whole Area. */
  blockId: string | null;
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

/** Run start instants inside [fromMs, toMs), oldest first, never before the
 *  schedule's `activeFrom`. */
export function expandRuns(
  schedule: Pick<StoredSchedule, 'days' | 'start'> & { activeFrom?: number },
  opts: { fromMs: number; toMs: number; timeZone: string }
): number[] {
  if (!(opts.toMs > opts.fromMs)) return [];
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
    if (schedule.activeFrom !== undefined && t < schedule.activeFrom) continue;
    if (out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/** Runs the owner or a helper said did not water are dropped. */
export function withoutSkipped(runs: readonly number[], skippedAt: Iterable<number>): number[] {
  const skipped = new Set(skippedAt);
  return runs.filter((t) => !skipped.has(t));
}

/** Gallons a run gives: only for a single target, where the gallons have one
 *  place to go. */
function runGallons(w: Waterer): number | null {
  const gpm = w.schedule.gallonsPerMinute;
  if (gpm === null || gpm === undefined || w.targets.length !== 1) return null;
  return gpm * w.schedule.minutes;
}

/** The amount a run puts down when the owner typed it; null otherwise. */
export function runInches(w: Waterer): number | null {
  return w.schedule.inchesPerRun ?? null;
}

/** Each past run as a watering on every target of `fieldId`, tagged
 *  `manual` (R-12); the amount stays unknown when the schedule has none. */
export function timerLogs(
  w: Waterer,
  runs: readonly number[],
  fieldId: string,
  nowMs: number
): WaterLog[] {
  const targets = w.targets.filter((t) => t.fieldId === fieldId);
  const inches = runInches(w);
  const gallons = inches === null ? runGallons(w) : null;
  return runs
    .filter((t) => t <= nowMs)
    .flatMap((t) =>
      targets.map((target) => ({
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
