import { eventsForPlanting, type CalendarEvent } from '$lib/calendar/engine';
import type { BlockWithPlantings, PlantingRecord } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { DEFAULT_PREFS, formatCalendarDate, formatQuantity, type Prefs } from '$lib/prefs';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlantingStatus = 'planned' | 'active' | 'mature';

export function plantingStatus(
  plantingDate: number | null,
  daysToMaturity: number | undefined,
  now: number = Date.now()
): PlantingStatus {
  if (plantingDate == null) return 'planned';
  const dap = (now - plantingDate) / DAY_MS;
  if (dap < 0) return 'planned';
  if (daysToMaturity && dap > daysToMaturity) return 'mature';
  return 'active';
}

export function plantingRoleLabel(p: Pick<PlantingRecord, 'groupRole'>): string {
  if (p.groupRole === 'anchor') return 'Anchor';
  if (p.groupRole === 'companion') return 'Companion';
  return 'Primary';
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
  now: number = Date.now()
): string | undefined {
  if (planting.plantingDate == null) return undefined;
  const stages = events
    .filter((e) => e.kind === 'stage-window' && e.cropId === planting.id)
    .sort((a, b) => a.startMs - b.startMs);
  if (stages.length === 0) return undefined;
  const containing = stages.filter((e) => e.startMs <= now && now <= e.endMs);
  if (containing.length > 0) return stageText(containing[containing.length - 1]);
  if (now < planting.plantingDate) return 'Not yet planted';
  const past = stages.filter((e) => e.endMs < now);
  const future = stages.filter((e) => e.startMs > now);
  if (past.length === 0) return 'Pre-emergence';
  if (future.length === 0) return `${stageText(past[past.length - 1])} (past)`;
  return stageText(past[past.length - 1]);
}

function fmtMonthDay(ms: number): string {
  return formatCalendarDate(ms, 'month-day');
}

/**
 * Block-level harvest window: earliest start → latest end across the
 * block's still-relevant harvest-window events (ones that have not
 * already closed). Undefined when nothing remains.
 */
export function blockHarvestWindowLabel(
  events: readonly CalendarEvent[],
  now: number = Date.now()
): string | undefined {
  const open = events.filter((e) => e.kind === 'harvest-window' && e.endMs >= now);
  if (open.length === 0) return undefined;
  const start = Math.min(...open.map((e) => e.startMs));
  const end = Math.max(...open.map((e) => e.endMs));
  const a = fmtMonthDay(start);
  const b = fmtMonthDay(end);
  return a === b ? a : `${a} – ${b}`;
}

/** Start of the planting's earliest harvest window from the engine. */
export function plantingHarvestLabel(
  events: readonly CalendarEvent[],
  plantingId: string
): string | undefined {
  const starts = events
    .filter((e) => e.kind === 'harvest-window' && e.cropId === plantingId)
    .map((e) => e.startMs);
  return starts.length ? fmtMonthDay(Math.min(...starts)) : undefined;
}

export type BlockStatus = 'empty' | 'planned' | 'active' | 'mature';

export function blockStatus(statuses: readonly PlantingStatus[]): BlockStatus {
  if (statuses.length === 0) return 'empty';
  if (statuses.includes('active')) return 'active';
  if (statuses.every((s) => s === 'mature')) return 'mature';
  return 'planned';
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
