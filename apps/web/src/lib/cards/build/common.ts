import { DEFAULT_PREFS, formatCalendarDate, formatInstant, ymdInZone, type Prefs } from '$lib/prefs';
import {
  AREA_KIND_LABELS,
  BLOCK_KIND_LABELS,
  CROP_AREA_KINDS as CROP_AREA_KIND_LIST
} from '$lib/farm/areaKinds';
import type { CardAction } from '../model';
import type {
  FarmSnapshot,
  SnapshotArea,
  SnapshotAreaKind,
  SnapshotBlock,
  SnapshotBlockKind,
  SnapshotTask
} from '../snapshot';

export interface BuildOptions {
  prefs?: Prefs;
  /** Epoch ms used for "due" and "days since planting" wording. */
  now?: number;
}

export interface ResolvedOptions {
  prefs: Prefs;
  now: number;
}

export function resolveOptions(snapshot: FarmSnapshot, opts: BuildOptions = {}): ResolvedOptions {
  return { prefs: opts.prefs ?? DEFAULT_PREFS, now: opts.now ?? snapshot.generatedAt };
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function ymdToUtcMs(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const m = YMD.exec(ymd);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return ms;
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const ms = ymdToUtcMs(ymd);
  if (ms === null || !Number.isFinite(days)) return null;
  return new Date(ms + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `fromYmd` to `toYmd` (negative when `to` is earlier). */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = ymdToUtcMs(fromYmd);
  const b = ymdToUtcMs(toYmd);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

export function monthDay(ymd: string): string {
  return formatCalendarDate(ymd, 'month-day');
}

export function dateRange(startYmd: string, endYmd: string): string {
  const a = monthDay(startYmd);
  const b = monthDay(endYmd);
  return a === b ? a : `${a} – ${b}`;
}

export function trimNumber(n: number, digits = 1): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export const AREA_KIND_LABEL: Readonly<Record<SnapshotAreaKind, string>> = AREA_KIND_LABELS;

export const CROP_AREA_KINDS: ReadonlySet<SnapshotAreaKind> = new Set(CROP_AREA_KIND_LIST);

export const BLOCK_KIND_LABEL: Readonly<Record<SnapshotBlockKind, string>> = BLOCK_KIND_LABELS;

export function areaKindLabel(kind: SnapshotAreaKind | null | undefined): string {
  return (kind && AREA_KIND_LABEL[kind]) || AREA_KIND_LABEL.field;
}

/** "Hayfield" when the owner named it, otherwise the kind label. Never
 *  "{kind} area". */
export function areaDisplayName(area: Pick<SnapshotArea, 'name' | 'kind'>): string {
  const name = area.name.trim();
  return name || areaKindLabel(area.kind);
}

export function blockDisplayName(block: Pick<SnapshotBlock, 'name' | 'kind' | 'blockLabel'>): string {
  const name = block.name.trim();
  if (name) return name;
  const label = BLOCK_KIND_LABEL[block.kind] ?? BLOCK_KIND_LABEL.block;
  return block.blockLabel ? `${label} ${block.blockLabel}` : label;
}

export function dueLabel(scheduledFor: number, now: number, prefs: Prefs): string {
  const due = ymdInZone(scheduledFor, prefs.timeZone);
  const today = ymdInZone(now, prefs.timeZone);
  const diff = daysBetweenYmd(today, due);
  if (diff === null) return formatInstant(scheduledFor, prefs, 'month-day');
  if (diff < 0) return `overdue since ${formatInstant(scheduledFor, prefs, 'month-day')}`;
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  if (diff < 7) return `due ${formatInstant(scheduledFor, prefs, 'weekday')}`;
  return `due ${formatInstant(scheduledFor, prefs, 'month-day')}`;
}

export function sortTasks(tasks: readonly SnapshotTask[]): SnapshotTask[] {
  return [...tasks].sort((a, b) => a.scheduledFor - b.scheduledFor || a.id.localeCompare(b.id));
}

export function nextAction(
  tasks: readonly SnapshotTask[],
  opts: ResolvedOptions
): CardAction | undefined {
  const first = sortTasks(tasks)[0];
  if (!first) return undefined;
  return {
    label: first.title,
    href: `/today?task=${encodeURIComponent(first.id)}`,
    due: dueLabel(first.scheduledFor, opts.now, opts.prefs)
  };
}
