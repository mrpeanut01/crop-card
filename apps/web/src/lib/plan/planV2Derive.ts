import { eventsForPlanting, type CalendarEvent } from '$lib/calendar/engine';
import { harvestWindowFromEvents, type HarvestWindowSpan } from '$lib/calendar/harvestWindow';
import type { BlockWithPlantings, PlantingRecord } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { t } from '$lib/i18n';
import {
  DEFAULT_PREFS,
  formatCalendarDate,
  formatDueDay,
  formatQuantity,
  type Prefs
} from '$lib/prefs';
import { deriveTaskStatus } from '$lib/tasks/status';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlantingStatus = 'planned' | 'active' | 'mature' | 'harvested' | 'ended';

type StoredPlantingStatus = PlantingRecord['status'];

/** #623: the stored status wins once the planting was marked harvested,
 *  failed or archived; otherwise the planting date and days to maturity
 *  tell planned, active and mature apart. */
export function plantingStatus(
  plantingDate: number | null,
  daysToMaturity: number | undefined,
  now: number = Date.now(),
  stored?: StoredPlantingStatus
): PlantingStatus {
  if (stored === 'harvested') return 'harvested';
  if (stored === 'failed' || stored === 'archived') return 'ended';
  if (plantingDate == null) return 'planned';
  const dap = (now - plantingDate) / DAY_MS;
  if (dap < 0) return 'planned';
  if (daysToMaturity && dap > daysToMaturity) return 'mature';
  return 'active';
}

/** #623: whether /plan's block view shows the planting. A failed or
 *  archived planting is over; a harvested one is over too unless it is a
 *  perennial, which still stands in the block after its harvest (#751).
 *  Everything else (planned, growing, mature) is shown. */
export function plantingOnView(
  p: Pick<PlantingRecord, 'status'>,
  perennial: boolean = false
): boolean {
  if (p.status === 'failed' || p.status === 'archived') return false;
  if (p.status === 'harvested') return perennial;
  return true;
}

/** The block's plantings split into the ones /plan shows and the earlier
 *  ones that are over (they stay in Records). */
export function splitBlockPlantings<T extends Pick<PlantingRecord, 'status' | 'cropPluginId'>>(
  plantings: readonly T[],
  isPerennial: (cropPluginId: string) => boolean = () => false
): { current: T[]; ended: T[] } {
  const current: T[] = [];
  const ended: T[] = [];
  for (const p of plantings) {
    (plantingOnView(p, isPerennial(p.cropPluginId)) ? current : ended).push(p);
  }
  return { current, ended };
}

/** #623: the planting a one-planting page opens on: the first, in the
 *  caller's order, already in the ground at `now`, else the first. */
export function defaultStandingPlanting<T extends { plantingDate: number | null }>(
  plantings: readonly T[],
  now: number
): T | undefined {
  return plantings.find((p) => p.plantingDate !== null && p.plantingDate <= now) ?? plantings[0];
}

/** Every block with only the plantings /plan shows (`splitBlockPlantings`),
 *  plus how many earlier plantings each block had that are over. */
export function blocksOnView(
  blocks: readonly BlockWithPlantings[],
  isPerennial: (cropPluginId: string) => boolean = () => false
): { blocks: BlockWithPlantings[]; endedCount: Map<string, number> } {
  const endedCount = new Map<string, number>();
  const out = blocks.map((b) => {
    const { current, ended } = splitBlockPlantings(b.plantings, isPerennial);
    if (ended.length === 0) return b;
    endedCount.set(b.id, ended.length);
    return { ...b, plantings: current };
  });
  return { blocks: out, endedCount };
}

type SpanPlanting = Pick<PlantingRecord, 'id' | 'cropPluginId' | 'plantingDate' | 'groupRole'>;

/** When the planting is in the ground: its date to the end of its last
 *  harvest or cover termination window, else to days to maturity after
 *  planting. An undated planting, or one with no end, is open-ended. */
export function plantingSpan(
  p: SpanPlanting,
  events: readonly CalendarEvent[],
  daysToMaturity: number | undefined
): { startMs: number; endMs: number } {
  const startMs = p.plantingDate ?? Number.NEGATIVE_INFINITY;
  const ends = events
    .filter(
      (e) => e.cropId === p.id && (e.kind === 'harvest-window' || e.kind === 'cover-termination')
    )
    .map((e) => e.endMs);
  if (ends.length > 0) return { startMs, endMs: Math.max(...ends) };
  if (p.plantingDate != null && daysToMaturity) {
    return { startMs, endMs: p.plantingDate + daysToMaturity * DAY_MS };
  }
  return { startMs, endMs: Number.POSITIVE_INFINITY };
}

/** #623: a planting's companions are the other shown plantings in the
 *  block that share time in the ground with it, or that the plan grouped
 *  with it (anchor and companion roles). A rotation (corn, then a rye
 *  cover, then next year's soybeans) has none. */
export function blockCompanions<T extends SpanPlanting>(
  plantings: readonly T[],
  events: readonly CalendarEvent[],
  daysToMaturity: (cropPluginId: string) => number | undefined
): Map<string, T[]> {
  const spans = new Map(
    plantings.map((p) => [p.id, plantingSpan(p, events, daysToMaturity(p.cropPluginId))])
  );
  const out = new Map<string, T[]>();
  for (const a of plantings) {
    const sa = spans.get(a.id)!;
    out.set(
      a.id,
      plantings.filter((b) => {
        if (b.id === a.id) return false;
        if (a.groupRole && b.groupRole) return true;
        const sb = spans.get(b.id)!;
        return sa.startMs < sb.endMs && sb.startMs < sa.endMs;
      })
    );
  }
  return out;
}

export function plantingRoleLabel(
  p: Pick<PlantingRecord, 'groupRole'>,
  locale?: string | null
): string {
  if (p.groupRole === 'anchor') return t(locale, 'plantui.role.anchor');
  if (p.groupRole === 'companion') return t(locale, 'plantui.role.companion');
  return t(locale, 'plantui.role.primary');
}

function stageText(e: CalendarEvent): string {
  const code = typeof e.detail?.stageCode === 'string' ? e.detail.stageCode : undefined;
  const name = typeof e.detail?.stageName === 'string' ? e.detail.stageName : undefined;
  if (code && name && code !== name) return `${code} · ${name}`;
  return name ?? code ?? e.title;
}

/**
 * Current growth stage for a planting, derived from the calendar engine's
 * `stage-window` events. Returns undefined when the engine emitted no stage
 * table for the crop (the card renders "—").
 */
export function currentStageLabel(
  events: readonly CalendarEvent[],
  planting: Pick<PlantingRecord, 'id' | 'plantingDate'>,
  now: number = Date.now(),
  locale?: string | null
): string | undefined {
  if (planting.plantingDate == null) return undefined;
  const stages = events
    .filter((e) => e.kind === 'stage-window' && e.cropId === planting.id)
    .sort((a, b) => a.startMs - b.startMs);
  if (stages.length === 0) return undefined;
  const containing = stages.filter((e) => e.startMs <= now && now <= e.endMs);
  if (containing.length > 0) return stageText(containing[containing.length - 1]);
  if (now < planting.plantingDate) return t(locale, 'plantui.stage.notPlanted');
  const past = stages.filter((e) => e.endMs < now);
  const future = stages.filter((e) => e.startMs > now);
  if (past.length === 0) return t(locale, 'plantui.stage.preEmergence');
  if (future.length === 0)
    return t(locale, 'plantui.stage.past', { stage: stageText(past[past.length - 1]) });
  return stageText(past[past.length - 1]);
}

function fmtMonthDay(ms: number, locale?: string | null): string {
  return formatCalendarDate(ms, 'month-day', {}, locale);
}

/**
 * Block-level harvest window: earliest start → latest end across the
 * block's still-relevant harvest-window events (ones that have not
 * already closed). Undefined when nothing remains.
 */
export function blockHarvestWindowLabel(
  events: readonly CalendarEvent[],
  now: number = Date.now(),
  locale?: string | null
): string | undefined {
  const cropIds = new Set(
    events.filter((e) => e.kind === 'harvest-window').map((e) => e.cropId ?? '')
  );
  const open = [...cropIds]
    .map((id) =>
      harvestWindowFromEvents(
        events.filter((e) => (e.cropId ?? '') === id),
        id,
        now
      )
    )
    .filter((w): w is HarvestWindowSpan => w !== null && w.endMs >= now);
  if (open.length === 0) return undefined;
  const start = Math.min(...open.map((e) => e.startMs));
  const end = Math.max(...open.map((e) => e.endMs));
  const a = fmtMonthDay(start, locale);
  const b = fmtMonthDay(end, locale);
  return a === b ? a : `${a} – ${b}`;
}

/** Start of the planting's harvest window from the engine: the one open
 *  now, else the next (#680, the same window /harvest shows). */
export function plantingHarvestLabel(
  events: readonly CalendarEvent[],
  plantingId: string,
  locale?: string | null,
  now: number = Date.now()
): string | undefined {
  const window = harvestWindowFromEvents(events, plantingId, now);
  return window ? fmtMonthDay(window.startMs, locale) : undefined;
}

export type BlockStatus = 'empty' | 'planned' | 'active' | 'mature';

export function blockStatus(statuses: readonly PlantingStatus[]): BlockStatus {
  if (statuses.length === 0) return 'empty';
  if (statuses.includes('active')) return 'active';
  if (statuses.every((s) => s === 'mature' || s === 'harvested')) return 'mature';
  return 'planned';
}

/** The block status pill's text: English keeps the status code. */
export function blockStatusLabel(s: BlockStatus, locale?: string | null): string {
  return locale && locale !== 'en' ? t(locale, `plantui.blockStatus.${s}`) : s;
}

export function blockStatusTone(s: BlockStatus): 'forest' | 'sky' | 'wheat' | 'neutral' {
  return s === 'active' ? 'forest' : s === 'planned' ? 'sky' : s === 'mature' ? 'wheat' : 'neutral';
}

export function fmtAcres(acres: number, prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS): string {
  return formatQuantity(acres, 'area', prefs);
}

const PLAN_V2_EVENT_KINDS = new Set<CalendarEvent['kind']>([
  'planting',
  'stage-window',
  'harvest-window',
  'cover-termination'
]);

/** Calendar-engine events the Plan v2 shell renders (timeline + stage + harvest pill). */
export function planV2EventsFor(
  blocks: readonly BlockWithPlantings[],
  cropFor: (pluginId: string) => CropPlugin | undefined
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const b of blocks) {
    for (const p of b.plantings) {
      const crop = cropFor(p.cropPluginId);
      if (!crop) continue;
      for (const e of eventsForPlanting(p, crop, { blockPlantings: b.plantings })) {
        if (PLAN_V2_EVENT_KINDS.has(e.kind)) out.push({ ...e, body: undefined });
      }
    }
  }
  return out;
}

export type ScheduledTaskStatus = 'overdue' | 'today' | 'scheduled';

/** Date label and status for an open task on the Scheduled tasks card,
 *  both by the same due-day rule (`dueYmd`) as /today. */
export function scheduledTaskTiming(
  scheduledFor: number,
  now: number,
  prefs: Prefs
): { dateLabel: string; status: ScheduledTaskStatus } {
  const s = deriveTaskStatus({ scheduledFor }, now, prefs.timeZone);
  return {
    dateLabel: formatDueDay(scheduledFor, prefs, 'month-day'),
    status: s === 'late' ? 'overdue' : s === 'due-today' ? 'today' : 'scheduled'
  };
}
