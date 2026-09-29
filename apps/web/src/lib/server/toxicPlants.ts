import { plantsInGroundByArea } from '$lib/db/areaPlants';
import { getBaseRegistry, getDataKinds, getRegistry } from '$lib/server/registry';
import { toxicCropsByArea, type ToxicPlantsByArea } from '$lib/animals/toxicAdjacency';
import type { CropPlugin } from '$lib/plugins/schemas';

export interface ToxicPlantsData {
  toxicPlants: ToxicPlantsByArea;
  /** Species id → plural tile label ("Goats"), for the callout wording. */
  speciesPlural: Record<string, string>;
}

/**
 * The active Owner's toxic-plant advisory inputs (Phase 32D, D5). The
 * toxicity lists come from the shipped library only, where every entry has
 * a quoted source (`crop-data-sources.json`), so a farm copy of a crop can
 * neither drop nor invent one. The name shown is the farm's own.
 */
export async function loadToxicPlants(now: number = Date.now()): Promise<ToxicPlantsData> {
  const [base, registry, kinds] = await Promise.all([
    getBaseRegistry(),
    getRegistry(),
    getDataKinds()
  ]);
  const speciesPlural: Record<string, string> = {};
  for (const s of kinds.species.all()) speciesPlural[s.pluginId] = s.tile.label ?? s.displayName;
  const plantings = plantsInGroundByArea(now);
  if (plantings.length === 0) return { toxicPlants: {}, speciesPlural };
  const toxicPlants = toxicCropsByArea(plantings, (id) => {
    const shipped = base.get(id)?.plugin;
    if (shipped?.type !== 'crop') return null;
    const toxicity = (shipped as CropPlugin).animalToxicity;
    if (!toxicity?.length) return null;
    const own = registry.get(id)?.plugin;
    return { name: own?.displayName ?? shipped.displayName, toxicity };
  });
  return { toxicPlants, speciesPlural };
}
