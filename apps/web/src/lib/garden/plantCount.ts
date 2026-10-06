/**
 * Plant counts from a footprint and spacing. Formulas: docs/design/GARDEN_DESIGNER.md
 * ("Plant count").
 */

import { FOOTPRINT_SNAP_IN, SFG_SNAP_IN } from './geometry';
import {
  AREA_UNIT_SQFT,
  spacingModel,
  type SeedingRateFields,
  type TreeSizeRow
} from '$lib/plan/spacingModel';
import type {
  Footprint,
  GardenCrop,
  PlantCountResult,
  PlantSpacing,
  SpacingPattern
} from './types';

/** Placeholder for a crop with no spacing on file. It has no source, so
 *  every use is tagged `fallback` (#555). */
export const FALLBACK_SPACING_IN = 12;
export const FALLBACK_SPACING_PROVENANCE = 'fallback' as const;

export interface SpacingValue {
  inches: number;
  provenance: 'plugin' | typeof FALLBACK_SPACING_PROVENANCE;
}

interface SpacingFields {
  archetype?: string | null;
  defaultRowSpacingInches?: number | null;
  treeSizeClasses?: readonly TreeSizeRow[] | null;
  plantingGuide?: {
    rowSpacingIn?: number | null;
    inRowSpacingIn?: { min: number; max: number } | null;
    seedingRate?: SeedingRateFields | null;
  } | null;
}

/** Side of one engine unit for a crop sown by area (one square foot). */
export const AREA_UNIT_IN = Math.sqrt(AREA_UNIT_SQFT) * 12;

const EPS = 1e-9;
const SFG_CELL_IN = 12;

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function fl(value: number): number {
  return Math.max(0, Math.floor(value + EPS));
}

/** #548: a tree crop is spaced by its size class both ways (the minimum
 *  distance between trees); null for any other crop. */
function treeSpacing(
  crop: SpacingFields | undefined,
  treeSizeClass?: string | null
): SpacingValue | null {
  const model = spacingModel(crop, treeSizeClass);
  return model.kind === 'tree' ? { inches: model.spacingIn, provenance: model.provenance } : null;
}

/** Row spacing: the plugin's row spacing, then `defaultRowSpacingInches`,
 *  else the tagged placeholder. A tree crop uses its size class (#548), or
 *  else its minimum distance between trees both ways (#587: no allowed
 *  source gives a between-row figure for tree fruit). */
export function rowSpacingOf(
  crop: SpacingFields | undefined,
  treeSizeClass?: string | null
): SpacingValue {
  const tree = treeSpacing(crop, treeSizeClass);
  if (tree) return tree;
  const row = crop?.plantingGuide?.rowSpacingIn;
  if (positive(row)) return { inches: row, provenance: 'plugin' };
  const def = crop?.defaultRowSpacingInches;
  if (positive(def)) return { inches: def, provenance: 'plugin' };
  if (crop?.archetype === 'tree-fruit-multi-pick') return inRowSpacingOf(crop);
  return { inches: FALLBACK_SPACING_IN, provenance: FALLBACK_SPACING_PROVENANCE };
}

/** In-row spacing: the midpoint of the plugin's in-row range, else the tagged
 *  placeholder. Row spacing is never used as in-row spacing. */
export function inRowSpacingOf(
  crop: SpacingFields | undefined,
  treeSizeClass?: string | null
): SpacingValue {
  const tree = treeSpacing(crop, treeSizeClass);
  if (tree) return tree;
  const range = crop?.plantingGuide?.inRowSpacingIn;
  const mid = range ? (range.min + range.max) / 2 : NaN;
  if (positive(mid)) return { inches: mid, provenance: 'plugin' };
  return { inches: FALLBACK_SPACING_IN, provenance: FALLBACK_SPACING_PROVENANCE };
}

/** Plugin spacing (in-row midpoint, row spacing), else the tagged placeholder
 *  in-row with the plugin's row spacing when it has one. A manual override
 *  wins for whichever values it carries. */
export function resolveSpacing(
  crop: GardenCrop | undefined,
  pattern: SpacingPattern,
  override?: { inRowIn?: number | null; rowIn?: number | null },
  treeSizeClass?: string | null
): PlantSpacing {
  // #555: a crop sown by area has no rows of counted plants, so a typed
  // spacing does not turn it into one.
  if (spacingModel(crop).kind === 'area') {
    return { inRowIn: AREA_UNIT_IN, rowIn: AREA_UNIT_IN, pattern, source: 'plugin', mode: 'area' };
  }
  const inRow = inRowSpacingOf(crop, treeSizeClass);
  const tree = treeSpacing(crop, treeSizeClass);
  const guideRow = crop?.plantingGuide?.rowSpacingIn;
  let inRowIn = inRow.inches;
  let rowIn: number;
  let source: PlantSpacing['source'];
  if (tree) {
    rowIn = tree.inches;
    source = tree.provenance;
  } else if (inRow.provenance === 'plugin') {
    rowIn = positive(guideRow) ? guideRow : inRow.inches;
    source = 'plugin';
  } else {
    rowIn = rowSpacingOf(crop).inches;
    source = FALLBACK_SPACING_PROVENANCE;
  }
  if (positive(override?.inRowIn)) {
    inRowIn = override.inRowIn;
    source = 'manual';
  }
  if (positive(override?.rowIn)) {
    rowIn = override.rowIn;
    source = 'manual';
  }
  return { inRowIn, rowIn, pattern, source };
}

function layout(
  w: number,
  l: number,
  spacing: PlantSpacing
): { rows: number; perRow: number; count: number } {
  const s = spacing.inRowIn;
  switch (spacing.pattern) {
    case 'offset': {
      const pitch = (s * Math.sqrt(3)) / 2;
      const rows = w + EPS >= s ? fl((w - s) / pitch) + 1 : 1;
      const even = Math.max(1, fl(l / s));
      const odd = l + EPS >= s / 2 ? fl((l - s / 2) / s) : 0;
      const evenRows = Math.ceil(rows / 2);
      return { rows, perRow: even, count: evenRows * even + (rows - evenRows) * odd };
    }
    case 'sfg': {
      const cellsW = Math.max(1, fl(w / SFG_CELL_IN));
      const cellsL = Math.max(1, fl(l / SFG_CELL_IN));
      if (s <= SFG_CELL_IN + EPS) {
        const side = fl(SFG_CELL_IN / s);
        return { rows: cellsW * side, perRow: cellsL * side, count: cellsW * cellsL * side * side };
      }
      const k = Math.ceil(s / SFG_CELL_IN - EPS);
      const rows = Math.max(1, fl(cellsW / k));
      const perRow = Math.max(1, fl(cellsL / k));
      return { rows, perRow, count: rows * perRow };
    }
    default: {
      const rows = Math.max(1, fl(w / spacing.rowIn));
      const perRow = Math.max(1, fl(l / s));
      return { rows, perRow, count: rows * perRow };
    }
  }
}

/** Always at least 1: a footprint narrower or shorter than the spacing still
 *  holds one row or one plant along it. Provenance is `data` for plugin spacing, `fallback`
 *  when spacing fell back, and `manual` when the spacing was typed. For the
 *  offset pattern `perRow` is the count in the full (even) rows. */
export function plantCount(
  footprint: Pick<Footprint, 'w_in' | 'l_in'>,
  spacing: PlantSpacing
): PlantCountResult {
  const provenance =
    spacing.source === 'plugin' ? 'data' : spacing.source === 'manual' ? 'manual' : 'fallback';
  if (spacing.mode === 'area') return { count: null, rows: 0, perRow: 0, provenance, mode: 'area' };
  if (!positive(spacing.inRowIn) || !positive(spacing.rowIn)) {
    return { count: 1, rows: 1, perRow: 1, provenance };
  }
  const w = Number.isFinite(footprint.w_in) ? Math.max(0, footprint.w_in) : 0;
  const l = Number.isFinite(footprint.l_in) ? Math.max(0, footprint.l_in) : 0;
  const { rows, perRow, count } = layout(w, l, spacing);
  return {
    count: Math.max(1, count),
    rows: Math.max(1, rows),
    perRow: Math.max(1, perRow),
    provenance
  };
}

/** Smallest footprint of the bed's own width that holds `plants`, used when a
 *  crop is tapped into a bed with a planned quantity. Width is the bed's
 *  width snapped down to the pattern's step; length grows in steps. For a
 *  crop sown by area `plants` is square feet. */
export function footprintForCount(
  plants: number,
  spacing: PlantSpacing,
  bedWidthIn: number
): Pick<Footprint, 'w_in' | 'l_in'> {
  const step = spacing.pattern === 'sfg' ? SFG_SNAP_IN : FOOTPRINT_SNAP_IN;
  const w = Math.max(step, Math.floor(bedWidthIn / step + EPS) * step);
  if (spacing.mode === 'area') {
    const sqIn = Math.max(1, Number.isFinite(plants) ? plants : 1) * AREA_UNIT_SQFT * 144;
    return { w_in: w, l_in: Math.max(step, Math.ceil(sqIn / w / step - EPS) * step) };
  }
  const want = Math.max(1, Math.ceil(Number.isFinite(plants) ? plants : 1));
  const holds = (n: number) =>
    (plantCount({ w_in: w, l_in: n * step }, spacing).count ?? 0) >= want;
  const reach = Math.max(spacing.inRowIn, spacing.rowIn, SFG_CELL_IN);
  let hi = Math.max(1, Math.ceil((want * reach * 2 + 2 * SFG_CELL_IN) / step));
  if (!holds(hi)) return { w_in: w, l_in: hi * step };
  let lo = 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (holds(mid)) hi = mid;
    else lo = mid + 1;
  }
  return { w_in: w, l_in: lo * step };
}
