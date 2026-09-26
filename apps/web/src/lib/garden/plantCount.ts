/**
 * Plant counts from a footprint and spacing. Formulas: docs/design/GARDEN_DESIGNER.md
 * ("Plant count").
 */

import type {
  Footprint,
  GardenCrop,
  PlantCountResult,
  PlantSpacing,
  SpacingPattern
} from './types';

export const FALLBACK_SPACING_IN = 12;

function notImplemented(name: string): never {
  throw new Error(`lib/garden/plantCount.${name}: not implemented`);
}

/** Plugin spacing (in-row midpoint, row spacing), else
 *  `defaultRowSpacingInches` both ways, else `FALLBACK_SPACING_IN`. A manual
 *  override wins for whichever values it carries. */
export function resolveSpacing(
  _crop: GardenCrop | undefined,
  _pattern: SpacingPattern,
  _override?: { inRowIn?: number | null; rowIn?: number | null }
): PlantSpacing {
  return notImplemented('resolveSpacing');
}

/** Always at least 1. Provenance is `data` for plugin spacing, `fallback`
 *  when spacing fell back, and `manual` when the spacing was typed. */
export function plantCount(
  _footprint: Pick<Footprint, 'w_in' | 'l_in'>,
  _spacing: PlantSpacing
): PlantCountResult {
  return notImplemented('plantCount');
}

/** Smallest footprint of the bed's own width that holds `plants`, used when a
 *  crop is tapped into a bed with a planned quantity. */
export function footprintForCount(
  _plants: number,
  _spacing: PlantSpacing,
  _bedWidthIn: number
): Pick<Footprint, 'w_in' | 'l_in'> {
  return notImplemented('footprintForCount');
}
