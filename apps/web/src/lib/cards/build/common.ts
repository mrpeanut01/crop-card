import { numberToLocaleString } from '$lib/intlCache';
import {
  DEFAULT_PREFS,
  dueYmd,
  formatCalendarDate,
  formatDueDay,
  ymdInZone,
  type Prefs
} from '$lib/prefs';
import {
  AREA_KIND_LABELS,
  BLOCK_KIND_LABELS,
  CROP_AREA_KINDS as CROP_AREA_KIND_LIST
} from '$lib/farm/areaKinds';
import { createT, t, type Translator } from '$lib/i18n';
import { cropDisplayName } from '$lib/i18n/cropName';
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
  /** The day a garden's bed map shows, when it isn't `now` (the designer's
   *  scrubbed date). */
  bedMapOnMs?: number;
  /** `animal:<id>` / `group:<id>` subjects with a treatment or move still
   *  queued on this phone; their cards can't confirm "no holds". */
  unsyncedAnimalSubjects?: ReadonlySet<string>;
  /** The app language for the card's words. Defaults to `prefs.locale`;
   *  with neither the card is English. */
  locale?: string | null;
}

export interface ResolvedOptions {
  prefs: Prefs;
  now: number;
  /** Translator for the card's words (English when no locale is set). */
  tr: Translator;
}

/** Card options for `prefs` and `now`, with `locale` overriding the one
 *  `prefs` carries. */
export function resolvedFrom(
  prefs: Prefs | undefined,
  now: number,
  locale?: string | null
): ResolvedOptions {
  const base = prefs ?? DEFAULT_PREFS;
  const loc = locale ?? base.locale ?? null;
  const p = loc && base.locale !== loc ? { ...base, locale: loc } : base;
  return { prefs: p, now, tr: createT(loc) };
}

export function resolveOptions(snapshot: FarmSnapshot, opts: BuildOptions = {}): ResolvedOptions {
  return resolvedFrom(opts.prefs, opts.now ?? snapshot.generatedAt, opts.locale);
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

export function monthDay(ymd: string, locale?: string | null): string {
  return formatCalendarDate(ymd, 'month-day', {}, locale);
}

export function dateRange(startYmd: string, endYmd: string, locale?: string | null): string {
  const a = monthDay(startYmd, locale);
  const b = monthDay(endYmd, locale);
  return a === b ? a : t(locale, 'cards.dateRange', { from: a, to: b });
}

/** "60 days" or "55–70 days" for a days-to-maturity range. */
export function daysText(min: number, max: number, opts: Pick<ResolvedOptions, 'tr'>): string {
  return min === max
    ? opts.tr('cards.days.count', { count: min })
    : opts.tr('cards.days.range', { min, max });
}

export function trimNumber(n: number, digits = 1): string {
  return numberToLocaleString(n, 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export const AREA_KIND_LABEL: Readonly<Record<SnapshotAreaKind, string>> = AREA_KIND_LABELS;

export const CROP_AREA_KINDS: ReadonlySet<SnapshotAreaKind> = new Set(CROP_AREA_KIND_LIST);

export const BLOCK_KIND_LABEL: Readonly<Record<SnapshotBlockKind, string>> = BLOCK_KIND_LABELS;

export function areaKindLabel(
  kind: SnapshotAreaKind | null | undefined,
  locale?: string | null
): string {
  const k = kind && AREA_KIND_LABEL[kind] ? kind : 'field';
  return locale ? t(locale, `farm.kind.${k}`) : AREA_KIND_LABEL[k];
}

/** "Hayfield" when the owner named it, otherwise the kind label. Never
 *  "{kind} area". */
export function areaDisplayName(
  area: Pick<SnapshotArea, 'name' | 'kind'>,
  locale?: string | null
): string {
  const name = area.name.trim();
  return name || areaKindLabel(area.kind, locale);
}

export function blockKindLabel(kind: SnapshotBlockKind, locale?: string | null): string {
  const k = BLOCK_KIND_LABEL[kind] ? kind : 'block';
  return locale ? t(locale, `farm.blockKind.${k}`) : BLOCK_KIND_LABEL[k];
}

export function blockDisplayName(
  block: Pick<SnapshotBlock, 'name' | 'kind' | 'blockLabel'>,
  locale?: string | null
): string {
  const name = block.name.trim();
  if (name) return name;
  const label = blockKindLabel(block.kind, locale);
  return block.blockLabel ? `${label} ${block.blockLabel}` : label;
}

/** "due today", "overdue since Oct 3"; in the language `prefs.locale` names. */
export function dueLabel(scheduledFor: number, now: number, prefs: Prefs): string {
  const due = dueYmd(scheduledFor, prefs.timeZone);
  const today = ymdInZone(now, prefs.timeZone);
  const diff = daysBetweenYmd(today, due);
  const loc = prefs.locale;
  if (diff === null) return formatDueDay(scheduledFor, prefs, 'month-day');
  if (diff < 0)
    return t(loc, 'cards.due.overdueSince', {
      date: formatDueDay(scheduledFor, prefs, 'month-day')
    });
  if (diff === 0) return t(loc, 'cards.due.today');
  if (diff === 1) return t(loc, 'cards.due.tomorrow');
  if (diff < 7)
    return t(loc, 'cards.due.weekday', { day: formatDueDay(scheduledFor, prefs, 'weekday') });
  return t(loc, 'cards.due.on', { date: formatDueDay(scheduledFor, prefs, 'month-day') });
}

export function sortTasks(tasks: readonly SnapshotTask[]): SnapshotTask[] {
  return [...tasks].sort((a, b) => a.scheduledFor - b.scheduledFor || a.id.localeCompare(b.id));
}

/** Where a task opens: its block's scheduled-tasks list on /plan. */
export function taskPlanHref(blockId: string | null | undefined): string {
  return blockId
    ? `/plan?block=${encodeURIComponent(blockId)}#plan-scheduled-tasks`
    : '/plan#plan-scheduled-tasks';
}

export function nextAction(
  tasks: readonly SnapshotTask[],
  opts: ResolvedOptions,
  plantings: readonly { id: string; blockId: string }[] = []
): CardAction | undefined {
  const first = sortTasks(tasks)[0];
  if (!first) return undefined;
  const blockId = first.blockId ?? plantings.find((p) => p.id === first.cropId)?.blockId ?? null;
  return {
    label: first.title,
    href: taskPlanHref(blockId),
    due: dueLabel(first.scheduledFor, opts.now, opts.prefs)
  };
}

/** A planting's crop name for display: the Spanish plugin name when the
 *  stored name is still the plugin's English one; owner-typed names as is. */
export function plantingName(
  p: { cropPluginId: string; varietyDisplayName: string },
  locale?: string | null
): string {
  return cropDisplayName(p.cropPluginId, p.varietyDisplayName, locale);
}
