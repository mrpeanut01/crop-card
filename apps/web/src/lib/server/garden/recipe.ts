/**
 * Applying a bed recipe on the server. The recipe is recomputed from the bed
 * as stored, with the same pure `applyRecipe` the designer previews with,
 * and the kept steps are saved in one transaction through
 * `createPlacedPlantings`.
 */

import { listCrops } from '$lib/db/crops';
import type { Footprint } from '$lib/farm/footprint';
import type { RecipeRequest, RecipeResponse } from '$lib/garden/api';
import { occupancyIntervals } from '$lib/garden/occupancy';
import { applyRecipe } from '$lib/garden/recipes';
import type { BedRecipePlugin, CropPlugin } from '$lib/plugins/schemas';
import { designFrostForYear } from '$lib/server/gardenDesignLoad';
import {
  createPlacedPlantings,
  gardenFailure,
  isFailure,
  placedPlantingFromCrop,
  resolveDesignableBed,
  type GardenFailure
} from './placement';

const SPOT_TOLERANCE_IN = 1e-6;

function sameSpot(a: Footprint, b: Footprint): boolean {
  return (
    Math.abs(a.x_in - b.x_in) <= SPOT_TOLERANCE_IN &&
    Math.abs(a.y_in - b.y_in) <= SPOT_TOLERANCE_IN &&
    Math.abs(a.w_in - b.w_in) <= SPOT_TOLERANCE_IN &&
    Math.abs(a.l_in - b.l_in) <= SPOT_TOLERANCE_IN
  );
}

export type RecipeResult =
  { ok: true; status: 200 | 201; response: RecipeResponse } | GardenFailure;

export function applyBedRecipe(
  blockId: string,
  req: RecipeRequest,
  crops: Readonly<Record<string, CropPlugin>>,
  findRecipe: (pluginId: string) => BedRecipePlugin | undefined
): RecipeResult {
  const bed = resolveDesignableBed(blockId);
  if (isFailure(bed)) return bed;
  const recipe = findRecipe(req.recipePluginId);
  if (!recipe) return gardenFailure(404, `There's no bed recipe called ${req.recipePluginId}.`);

  const frost = designFrostForYear(req.seasonYear);
  const intervals = occupancyIntervals(
    listCrops({ blockId: bed.block.id }).map((c) =>
      placedPlantingFromCrop(c, crops[c.cropPluginId])
    ),
    crops,
    { firstFallFrostMs: frost.firstFallFrostMs, lastSpringFrostMs: frost.lastSpringFrostMs }
  );
  const application = applyRecipe(recipe, {
    bed: { blockId: bed.block.id, widthFt: bed.widthFt, lengthFt: bed.lengthFt },
    crops,
    ...frost,
    intervals,
    seasonYear: req.seasonYear
  });
  if (!req.commit) return { ok: true, status: 200, response: { application, created: [] } };

  const byKey = new Map(application.plantings.map((p) => [p.key, p]));
  const keys = [
    ...new Set(
      req.acceptKeys ?? req.expected?.map((e) => e.key) ?? application.plantings.map((p) => p.key)
    )
  ];
  if (keys.length === 0) return gardenFailure(400, 'Keep at least one planting to add.');
  const changed = (req.expected ?? []).some((e) => {
    const now = byKey.get(e.key);
    return !now || now.plantingDateMs !== e.plantingDateMs || !sameSpot(now.footprint, e.footprint);
  });
  if (changed || keys.some((k) => !byKey.has(k))) {
    return gardenFailure(
      409,
      `${bed.block.name} changed since this preview, so nothing was added. Open the recipe again to see what fits now.`,
      'STALE'
    );
  }
  const created = createPlacedPlantings(
    keys.map((k) => {
      const p = byKey.get(k)!;
      return {
        blockId: p.blockId,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName.slice(0, 120),
        plantingDateMs: p.plantingDateMs,
        footprint: p.footprint,
        spacingPattern: p.spacing.pattern,
        source: 'plugin' as const
      };
    }),
    (id) => crops[id]
  );
  if (isFailure(created)) return created;
  return { ok: true, status: 201, response: { application, created: created.plantings } };
}
