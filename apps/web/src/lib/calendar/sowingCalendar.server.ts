import { listCrops } from '$lib/db/crops';
import { listSeedStartFacts } from '$lib/db/sowingCalendar';
import { loadStoredFrost } from '$lib/climate/frostSettings.server';
import { storedFrostView } from '$lib/climate/frostSettings';
import { normalizeFrost } from '$lib/schedule/farmLocation';
import { frostDatesFromMmDd } from '$lib/schedule/frostSeason';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { deterministicPlantingWindow } from '$lib/plan/plantingWindow';
import { loadSeasonView } from '$lib/today/seasonView.server';
import type { PluginRegistry } from '$lib/plugins';
import type { CropPlugin } from '$lib/plugins/schemas';
import { eventsForPlanting, type CalendarEvent, type SeedStartFacts } from './engine';
import {
  buildSowingCalendar,
  type FrostLine,
  type RowFrost,
  type SowingCalendar
} from './sowingCalendar';

export interface SowingCalendarData {
  year: number;
  years: number[];
  calendar: SowingCalendar;
}

/** Per-bed frost after covers (the route passes E2's
 *  `loadEffectiveFrostByBlock`); without it every bed uses the farm's
 *  frost dates. */
export type FrostByBlockLoader = (
  blockIds: readonly string[],
  seasonYear: number
) => Readonly<Record<string, RowFrost>>;

const NO_SEED_START: SeedStartFacts = { establishment: null, sownIndoorsAt: null, tasks: [] };

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** The farm's frost lines for season `year`, each with the provenance of
 *  its saved value. Hard-frost lines show only when saved. */
export function frostLinesForYear(year: number): FrostLine[] {
  const stored = loadStoredFrost();
  const dates = {
    lastFrost: normalizeFrost(stored.dates.lastFrost),
    firstFrost: normalizeFrost(stored.dates.firstFrost),
    lastHardFrost: normalizeFrost(stored.dates.lastHardFrost),
    firstHardFrost: normalizeFrost(stored.dates.firstHardFrost)
  };
  const view = storedFrostView(dates, stored.provenance);
  const main = frostDatesFromMmDd(year, view.lastFrost.value, view.firstFrost.value);
  const lines: FrostLine[] = [
    { kind: 'last-spring', ms: main.lastSpringFrostMs, provenance: view.lastFrost.provenance },
    { kind: 'first-fall', ms: main.firstFallFrostMs, provenance: view.firstFrost.provenance }
  ];
  if (view.lastHardFrost.value || view.firstHardFrost.value) {
    const hard = frostDatesFromMmDd(year, view.lastHardFrost.value, view.firstHardFrost.value);
    if (view.lastHardFrost.value) {
      lines.push({
        kind: 'hard-last-spring',
        ms: hard.lastSpringFrostMs,
        provenance: view.lastHardFrost.provenance
      });
    }
    if (view.firstHardFrost.value) {
      lines.push({
        kind: 'hard-first-fall',
        ms: hard.firstFallFrostMs,
        provenance: view.firstHardFrost.provenance
      });
    }
  }
  return lines;
}

/**
 * The sowing calendar for `?year=`, with the same rows, order, names and
 * season-year rules as the /today Season view. Only this loader passes
 * `seedStart` to the engine (E3-4).
 */
export function loadSowingCalendar(
  registry: PluginRegistry,
  rawYear: string | null,
  now: number,
  opts: { frostByBlock?: FrostByBlockLoader; locale?: string | null } = {}
): SowingCalendarData {
  const season = loadSeasonView(registry, rawYear, now, opts.locale);
  const year = season.year;
  const rows = season.timeline.rows.filter((r) => !r.blockWork);
  const ids = new Set(rows.map((r) => r.plantingId));
  const crops = new Map(
    listCrops()
      .filter((c) => ids.has(c.id))
      .map((c) => [c.id, c])
  );
  const facts = listSeedStartFacts([...ids]);
  const frostByBlock = opts.frostByBlock?.([...new Set(rows.map((r) => r.blockId))], year) ?? {};

  const frostLines = frostLinesForYear(year);
  const farmFrost = {
    lastSpring: localDay(frostLines.find((l) => l.kind === 'last-spring')!.ms),
    firstFall: localDay(frostLines.find((l) => l.kind === 'first-fall')!.ms)
  };

  const events: CalendarEvent[] = [];
  const windows: Record<string, { startMs: number; endMs: number }> = {};
  const plantings = [];
  for (const r of rows) {
    const crop = crops.get(r.plantingId);
    if (!crop) continue;
    plantings.push({
      id: crop.id,
      name: r.name,
      blockId: r.blockId,
      blockName: r.blockName,
      plantingDate: crop.plantingDate,
      status: crop.status
    });
    const rec = registry.get(crop.cropPluginId);
    if (!rec || rec.plugin.type !== 'crop') continue;
    const plugin = rec.plugin as CropPlugin;
    if (crop.plantingDate !== null) {
      events.push(
        ...eventsForPlanting(
          {
            id: crop.id,
            blockId: crop.blockId,
            cropPluginId: crop.cropPluginId,
            varietyDisplayName: crop.varietyDisplayName,
            plantingDate: crop.plantingDate
          },
          plugin,
          { seedStart: facts.get(crop.id) ?? NO_SEED_START }
        ).filter(
          (e) => e.kind === 'indoor-sow' || e.kind === 'transplant' || e.kind === 'direct-sow'
        )
      );
      continue;
    }
    if (crop.status !== 'planned') continue;
    const bed = frostByBlock[crop.blockId];
    const frost = bed
      ? {
          lastSpring: localDay(bed.lastSpringFrostMs),
          firstFall: localDay(bed.firstFallFrostMs),
          frostFree: bed.frostFree
        }
      : farmFrost;
    const w = deterministicPlantingWindow(
      {
        cropFamily: plugin.cropFamily ?? null,
        soilTempMinF: plugin.plantingGuide?.soilTempMinF ?? null,
        dtmMaxDays: plugin.daysToMaturity?.max ?? null
      },
      frost
    );
    windows[crop.id] = { startMs: dayMs(w.earliest), endMs: dayMs(w.latest) };
  }

  return {
    year,
    years: season.years,
    calendar: buildSowingCalendar({
      year,
      now,
      fromMs: season.timeline.fromMs,
      toMs: season.timeline.toMs,
      plantings,
      events,
      windows,
      frostByBlock,
      frostLines,
      latLon: hasFarmLatLon() ? getFarmLatLon() : null
    })
  };
}
