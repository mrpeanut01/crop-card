/**
 * Plant counts from a footprint and spacing. Formulas: docs/design/GARDEN_DESIGNER.md
 * ("Plant count").
 */

import { FOOTPRINT_SNAP_IN, SFG_SNAP_IN } from './geometry';
import type {
  Footprint,
  GardenCrop,
  PlantCountResult,
  PlantSpacing,
  SpacingPattern
} from './types';

export const FALLBACK_SPACING_IN = 12;

const EPS = 1e-9;
const SFG_CELL_IN = 12;

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function fl(value: number): number {
  return Math.max(0, Math.floor(value + EPS));
}

/** Plugin spacing (in-row midpoint, row spacing), else
 *  `defaultRowSpacingInches` both ways, else `FALLBACK_SPACING_IN`. A manual
 *  override wins for whichever values it carries. */
export function resolveSpacing(
  crop: GardenCrop | undefined,
  pattern: SpacingPattern,
  override?: { inRowIn?: number | null; rowIn?: number | null }
): PlantSpacing {
  const guide = crop?.plantingGuide;
  const range = guide?.inRowSpacingIn;
  let inRowIn: number;
  let rowIn: number;
  let source: PlantSpacing['source'];
  const mid = range ? (range.min + range.max) / 2 : NaN;
  if (positive(mid)) {
    inRowIn = mid;
    rowIn = positive(guide?.rowSpacingIn) ? guide.rowSpacingIn : mid;
    source = 'plugin';
  } else {
    const fallback = positive(crop?.defaultRowSpacingInches)
      ? crop.defaultRowSpacingInches
      : FALLBACK_SPACING_IN;
    inRowIn = fallback;
    rowIn = fallback;
    source = 'fallback';
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
 *  width snapped down to the pattern's step; length grows in steps. */
export function footprintForCount(
  plants: number,
  spacing: PlantSpacing,
  bedWidthIn: number
): Pick<Footprint, 'w_in' | 'l_in'> {
  const step = spacing.pattern === 'sfg' ? SFG_SNAP_IN : FOOTPRINT_SNAP_IN;
  const w = Math.max(step, Math.floor(bedWidthIn / step + EPS) * step);
  const want = Math.max(1, Math.ceil(Number.isFinite(plants) ? plants : 1));
  const holds = (n: number) => plantCount({ w_in: w, l_in: n * step }, spacing).count >= want;
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
