/**
 * Test-only stand-ins for the geometry, plant-count and occupancy contract
 * functions, written straight from docs/design/GARDEN_DESIGNER.md. Tests of
 * the recipe applier and "Fill this bed" mock those modules with these so
 * they check their own logic, not the collaborators'.
 */

import type {
  Footprint,
  GardenCrop,
  OccupancyInterval,
  PlantCountResult,
  PlantSpacing,
  SpacingPattern
} from '../types';
import type { OccupancyOptions, OccupancyPlanting } from '../occupancy';

const DAY = 86_400_000;

const TAIL: Record<string, number | 'until-frost' | 'season'> = {
  'continuous-harvest-fruit': 'until-frost',
  'cut-and-come-again-leafy': 21,
  'forage-cutting-cycle': 'season',
  'perennial-vine-quality': 'season',
  'tree-fruit-multi-pick': 'season'
};

export function resolveSpacing(
  crop: GardenCrop | undefined,
  pattern: SpacingPattern,
  override?: { inRowIn?: number | null; rowIn?: number | null }
): PlantSpacing {
  const range = crop?.plantingGuide?.inRowSpacingIn;
  let inRowIn: number;
  let rowIn: number;
  let source: PlantSpacing['source'];
  if (range && range.max > 0) {
    inRowIn = (range.min + range.max) / 2;
    rowIn = crop?.plantingGuide?.rowSpacingIn ?? inRowIn;
    source = 'plugin';
  } else {
    inRowIn = crop?.defaultRowSpacingInches ?? 12;
    rowIn = inRowIn;
    source = 'fallback';
  }
  if (override?.inRowIn) {
    inRowIn = override.inRowIn;
    source = 'manual';
  }
  if (override?.rowIn) {
    rowIn = override.rowIn;
    source = 'manual';
  }
  return { inRowIn, rowIn, pattern, source };
}

export function plantCount(
  fp: Pick<Footprint, 'w_in' | 'l_in'>,
  s: PlantSpacing
): PlantCountResult {
  const provenance = s.source === 'plugin' ? 'data' : s.source === 'manual' ? 'manual' : 'fallback';
  let rows: number;
  let perRow: number;
  if (s.pattern === 'sfg') {
    const cellsW = Math.max(1, Math.floor(fp.w_in / 12));
    const cellsL = Math.max(1, Math.floor(fp.l_in / 12));
    if (s.inRowIn <= 12) {
      const side = Math.floor(12 / s.inRowIn);
      rows = cellsW * side;
      perRow = cellsL * side;
    } else {
      const k = Math.ceil(s.inRowIn / 12);
      rows = Math.max(1, Math.floor(cellsW / k));
      perRow = Math.max(1, Math.floor(cellsL / k));
    }
  } else {
    rows = Math.max(1, Math.floor(fp.w_in / s.rowIn));
    perRow = Math.max(1, Math.floor(fp.l_in / s.inRowIn));
  }
  return { count: Math.max(1, rows * perRow), rows, perRow, provenance };
}

export function footprintForCount(
  plants: number,
  s: PlantSpacing,
  bedWidthIn: number
): Pick<Footprint, 'w_in' | 'l_in'> {
  const rows = Math.max(1, Math.floor(bedWidthIn / s.rowIn));
  const perRow = Math.ceil(plants / rows);
  return { w_in: bedWidthIn, l_in: Math.max(6, Math.ceil((perRow * s.inRowIn) / 6) * 6) };
}

export function plantingOccupancy(
  p: OccupancyPlanting,
  crop: GardenCrop | undefined,
  opts: OccupancyOptions
): OccupancyInterval | null {
  if (p.plantingDateMs == null || p.status === 'failed' || p.status === 'archived') return null;
  const min = crop?.daysToMaturity?.min ?? 90;
  const max = crop?.daysToMaturity?.max ?? min;
  const startMs = p.plantingDateMs;
  const harvestStartMs = startMs + min * DAY;
  const tail = TAIL[crop?.archetype ?? ''] ?? 0;
  const harvestEndMs =
    typeof tail === 'number'
      ? startMs + (max + tail) * DAY
      : Math.max(startMs + max * DAY, opts.firstFallFrostMs);
  return {
    cropId: p.cropId,
    blockId: p.blockId,
    startMs,
    harvestStartMs,
    harvestEndMs,
    endMs: harvestEndMs + 10 * DAY,
    footprint: p.footprint,
    actual: false
  };
}

export function occupancyIntervals(
  plantings: readonly OccupancyPlanting[],
  crops: Readonly<Record<string, GardenCrop>>,
  opts: OccupancyOptions
): OccupancyInterval[] {
  return plantings
    .map((p) => plantingOccupancy(p, crops[p.cropPluginId], opts))
    .filter((i): i is OccupancyInterval => i !== null);
}

export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  return (
    a.x_in < b.x_in + b.w_in &&
    b.x_in < a.x_in + a.w_in &&
    a.y_in < b.y_in + b.l_in &&
    b.y_in < a.y_in + a.l_in
  );
}

export function fitFootprint(
  bed: { widthFt: number; lengthFt: number },
  want: { w_in: number; l_in: number },
  taken: readonly Footprint[]
): Footprint | null {
  const W = bed.widthFt * 12;
  const L = bed.lengthFt * 12;
  for (let y = 0; y + want.l_in <= L; y += 6) {
    for (let x = 0; x + want.w_in <= W; x += 6) {
      const fp = { x_in: x, y_in: y, w_in: want.w_in, l_in: want.l_in };
      if (!taken.some((t) => footprintsOverlap(t, fp))) return fp;
    }
  }
  return null;
}
