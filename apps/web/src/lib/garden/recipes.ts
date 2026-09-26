/**
 * Applying a bed recipe plugin to one bed, and the no-key "Fill this bed"
 * fallback. Pure: the caller passes frost dates, crops and occupancy.
 */

import type { BedRecipePlugin } from '$lib/plugins/schemas';
import type {
  BedLayout,
  GardenCrop,
  OccupancyInterval,
  ProposedPlanting,
  RecipeApplication
} from './types';

export type { BedRecipePlugin };

export interface RecipeContext {
  bed: Pick<BedLayout, 'blockId' | 'widthFt' | 'lengthFt'>;
  crops: Readonly<Record<string, GardenCrop>>;
  lastSpringFrostMs: number;
  firstFallFrostMs: number;
  /** Existing intervals on this bed; recipe steps never overlap them. */
  intervals: readonly OccupancyInterval[];
  seasonYear: number;
}

export type RecipeFit = { fits: true } | { fits: false; reason: string };

function notImplemented(name: string): never {
  throw new Error(`lib/garden/recipes.${name}: not implemented`);
}

/** Frost-free days (first fall minus last spring frost) inside the recipe's
 *  `frostFreeDays` range. Zone labels are never checked. */
export function recipeFits(_recipe: BedRecipePlugin, _frostFreeDays: number): RecipeFit {
  return notImplemented('recipeFits');
}

/** Scales each step's section to the bed, resolves the first registered
 *  crop among `cropPluginId` and `alternates`, dates it from its anchor and
 *  expands `successions`. Proposals carry `plugin` provenance; steps that
 *  cannot be placed land in `skipped`. */
export function applyRecipe(_recipe: BedRecipePlugin, _ctx: RecipeContext): RecipeApplication {
  return notImplemented('applyRecipe');
}

/** What "Fill this bed" returns without Claude: the best-fitting recipe's
 *  application when one fits the bed and season, otherwise the owner's
 *  unplaced planned crops packed into the free space on `dateMs` by
 *  spacing. Proposals carry `fallback` provenance. */
export function deterministicFill(
  _recipes: readonly BedRecipePlugin[],
  _unplaced: ReadonlyArray<{
    cropPluginId: string;
    varietyDisplayName: string;
    plants: number | null;
  }>,
  _ctx: RecipeContext,
  _dateMs: number
): ProposedPlanting[] {
  return notImplemented('deterministicFill');
}
