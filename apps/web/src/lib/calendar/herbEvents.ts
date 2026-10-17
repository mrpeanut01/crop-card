/**
 * Phase 37D herb calendar events (R-8, R-18). Two engine event kinds keyed
 * to the farm's frost dates: `bring-indoors` for a tender perennial herb
 * and `restart` for an annual herb when the garden brief asks for a steady
 * fresh supply. The verdict and the brief goals are inputs; nothing here
 * reads settings, the zone or the brief. Pure and client-safe.
 */

import { t } from '$lib/i18n';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import type { BriefStorageGoal } from '$lib/garden/preserving';
import type { LifecycleHere } from '$lib/garden/lifecycleTypes';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import { frostDatesFromMmDd } from '$lib/schedule/frostSeason';
import { successionIntervalDays } from '$lib/schedule/succession';

const DAY_MS = 86_400_000;

/** R-8: days before the first fall frost to bring a tender perennial in.
 *  One constant, no per-crop value: the low end of UW-Madison Extension's
 *  "2 to 3 weeks before the expected first fall frost" (quoted under
 *  `bringIndoorsLead` in `apps/web/scripts/calendar-sources.json`). */
export const BRING_INDOORS_LEAD_DAYS = 14;
export const BRING_INDOORS_LEAD_PROVENANCE = 'data' as const;
export const BRING_INDOORS_SOURCE = {
  key: 'bringIndoorsLead',
  url: 'https://hort.extension.wisc.edu/articles/rosemary/',
  publisher: 'UW-Madison Extension',
  weeksFrom: 2,
  weeksTo: 3
} as const;

/** The seasonal row key a crop's own sourced succession sowing uses; a
 *  crop that has one gets no `restart` from the family interval. */
export const SOW_AGAIN_ROW_KEY = 'sow-again';

/** How long a restart suggestion stays open, as a seasonal row's default
 *  window does. */
export const RESTART_WINDOW_DAYS = 7;

export const HERB_EVENT_KINDS = ['bring-indoors', 'restart'] as const;
export type HerbEventKind = (typeof HERB_EVENT_KINDS)[number];

export function isHerbEventKind(kind: unknown): kind is HerbEventKind {
  return kind === 'bring-indoors' || kind === 'restart';
}

/** What the caller knows about one herb planting (R-18). */
export interface HerbEventContext {
  /** The 37B verdict for this planting on this farm. */
  lifecycle: LifecycleHere | null;
  /** The garden brief's storage goals. */
  goals: ReadonlySet<BriefStorageGoal>;
  /** The farm's saved frost dates as `MM-DD`; a missing one uses the
   *  same default the rest of the calendar uses. */
  frost: { lastMmDd: string | null; firstMmDd: string | null };
}

export interface HerbEventOut {
  kind: HerbEventKind;
  startMs: number;
  endMs: number;
  title: string;
  body: string;
  detail: Record<string, unknown>;
}

export function wantsFreshSupply(goals: ReadonlySet<BriefStorageGoal>): boolean {
  return goals.has('fresh');
}

export function herbEventTitle(kind: HerbEventKind, name: string, locale?: string | null): string {
  return kind === 'bring-indoors'
    ? t(locale, 'herbsd.event.bringIndoors.title', { name })
    : t(locale, 'herbsd.event.restart.title', { name });
}

export function herbEventBody(kind: HerbEventKind, locale?: string | null): string {
  return kind === 'bring-indoors'
    ? t(locale, 'herbsd.event.bringIndoors.body')
    : t(locale, 'herbsd.event.restart.body');
}

const TITLE_PATTERNS: Record<HerbEventKind, RegExp> = {
  'bring-indoors': /^Bring (.+) indoors or take cuttings$/,
  restart: /^Sow (.+) again$/
};

/** The crop name inside an English herb event title, or null. */
export function herbTitleCrop(kind: HerbEventKind, title: string): string | null {
  return TITLE_PATTERNS[kind].exec(title)?.[1] ?? null;
}

/** First fall frost of each season in `years`, as UTC-midnight ms. */
function firstFallFrosts(years: readonly number[], frost: HerbEventContext['frost']): number[] {
  return years.map((y) => frostDatesFromMmDd(y, frost.lastMmDd, frost.firstMmDd).firstFallFrostMs);
}

/**
 * `bring-indoors` once a season for a tender perennial herb: from
 * `BRING_INDOORS_LEAD_DAYS` before the first fall frost to the frost itself,
 * never before the planting date. `years` are the season years the caller
 * renders (the engine's perennial years).
 */
export function bringIndoorsEvents(
  planting: Pick<PlantingRecord, 'plantingDate' | 'varietyDisplayName' | 'cropPluginId'>,
  ctx: HerbEventContext,
  years: readonly number[]
): HerbEventOut[] {
  if (planting.plantingDate == null) return [];
  if (ctx.lifecycle !== 'tender-perennial' || !isHerbGardenCrop(planting.cropPluginId)) return [];
  const plant = planting.plantingDate;
  const out: HerbEventOut[] = [];
  const seen = new Set<number>();
  for (const frostMs of firstFallFrosts(years, ctx.frost)) {
    if (seen.has(frostMs)) continue;
    seen.add(frostMs);
    const startMs = frostMs - BRING_INDOORS_LEAD_DAYS * DAY_MS;
    if (startMs < plant) continue;
    out.push({
      kind: 'bring-indoors',
      startMs,
      endMs: frostMs,
      title: herbEventTitle('bring-indoors', planting.varietyDisplayName),
      body: herbEventBody('bring-indoors'),
      detail: {
        herbEvent: 'bring-indoors',
        firstFallFrostMs: frostMs,
        leadDays: BRING_INDOORS_LEAD_DAYS,
        provenance: BRING_INDOORS_LEAD_PROVENANCE,
        sourceKey: BRING_INDOORS_SOURCE.key
      }
    });
  }
  return out;
}

/** The first fall frost after `ms` among the seasons around its year. */
function nextFirstFallFrost(ms: number, frost: HerbEventContext['frost']): number | null {
  const y = new Date(ms).getUTCFullYear();
  const after = firstFallFrosts([y - 1, y, y + 1], frost).filter((f) => f > ms);
  return after.length ? Math.min(...after) : null;
}

/**
 * `restart` for an annual herb when the brief wants fresh herbs all season:
 * one suggestion to sow again at the crop family's succession interval
 * after this planting, while that date still comes before the first fall
 * frost. A later planting of the same crop in the block means the owner
 * already sowed again, and a crop with its own sourced `sow-again` row
 * uses that row, so neither adds anything.
 */
export function restartEvents(
  planting: Pick<PlantingRecord, 'id' | 'plantingDate' | 'varietyDisplayName' | 'cropPluginId'>,
  crop: Pick<CropPlugin, 'cropFamily' | 'seasonalTasks'>,
  ctx: HerbEventContext,
  blockPlantings: readonly Pick<PlantingRecord, 'id' | 'plantingDate' | 'cropPluginId'>[] = []
): HerbEventOut[] {
  if (planting.plantingDate == null) return [];
  if (ctx.lifecycle !== 'annual' || !isHerbGardenCrop(planting.cropPluginId)) return [];
  if (!wantsFreshSupply(ctx.goals)) return [];
  if (crop.seasonalTasks?.some((r) => r.key === SOW_AGAIN_ROW_KEY)) return [];
  const intervalDays = successionIntervalDays(crop.cropFamily);
  if (intervalDays <= 0) return [];
  const plant = planting.plantingDate;
  const resown = blockPlantings.some(
    (p) =>
      p.id !== planting.id &&
      p.cropPluginId === planting.cropPluginId &&
      p.plantingDate != null &&
      p.plantingDate > plant
  );
  if (resown) return [];
  const startMs = plant + intervalDays * DAY_MS;
  const frostMs = nextFirstFallFrost(plant, ctx.frost);
  if (frostMs === null || startMs >= frostMs) return [];
  return [
    {
      kind: 'restart',
      startMs,
      endMs: startMs + RESTART_WINDOW_DAYS * DAY_MS,
      title: herbEventTitle('restart', planting.varietyDisplayName),
      body: herbEventBody('restart'),
      detail: {
        herbEvent: 'restart',
        intervalDays,
        firstFallFrostMs: frostMs,
        provenance: 'fallback',
        typicalTiming: true
      }
    }
  ];
}
