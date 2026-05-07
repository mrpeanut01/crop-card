import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { listFertilityApplicationsForBlock, listSoilTestsForBlock } from '$lib/db/fertility';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listCuttings } from '$lib/db/hayCuttings';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listTasks } from '$lib/db/tasks';
import { eventsForPlanting, type CalendarEvent } from '$lib/calendar/engine';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';

export const load: PageServerLoad = async ({ params }) => {
  const crop = getCrop(params.id);
  if (!crop) throw error(404, 'crop not found');

  const block = getBlock(crop.blockId);
  if (!block) throw error(500, 'crop references missing block');
  const registry = await getRegistry();
  const cropRecord = registry.get(crop.cropPluginId);
  const cropPlugin =
    cropRecord?.plugin.type === 'crop' ? (cropRecord.plugin as CropPlugin) : undefined;

  // Pull all event-table rows scoped to this crop (or block-scoped where the
  // event predates the cropId column being populated).
  const sprays = listSprayEvents({ blockId: crop.blockId, limit: 500 }).filter(
    (e) => !e.cropId || e.cropId === crop.id
  );
  const harvests = listHarvestEvents({ blockId: crop.blockId }).filter(
    (e) => !e.cropId || e.cropId === crop.id
  );
  const insecticides = listInsecticideEvents({ blockId: crop.blockId, limit: 500 }).filter(
    (e) => !e.cropId || e.cropId === crop.id
  );
  const cuttings = listCuttings({ blockId: crop.blockId, limit: 100 }).filter(
    (c) => !c.cropId || c.cropId === crop.id
  );
  const fertilityApps = listFertilityApplicationsForBlock(crop.blockId).filter(
    (f) => !f.cropId || f.cropId === crop.id
  );
  const soilTests = listSoilTestsForBlock(crop.blockId);
  const tasks = listTasks({ cropId: crop.id, limit: 200 });

  // Calendar engine projection — what the kernel still expects to happen
  // for this crop (spray windows, harvest windows, etc.) regardless of
  // what's been recorded.
  let projected: CalendarEvent[] = [];
  if (cropPlugin) {
    projected = eventsForPlanting(
      {
        id: crop.id,
        blockId: crop.blockId,
        cropPluginId: crop.cropPluginId,
        varietyDisplayName: crop.varietyDisplayName,
        plantingDate: crop.plantingDate
      },
      cropPlugin,
      { blockPlantings: block.plantings }
    );
  }

  return {
    crop,
    block: {
      id: block.id,
      name: block.name,
      acres: block.acres ?? null,
      blockLabel: block.blockLabel ?? null
    },
    cropPlugin: cropPlugin
      ? {
          pluginId: cropPlugin.pluginId,
          displayName: cropPlugin.displayName,
          cropFamily: cropPlugin.cropFamily,
          daysToMaturity: cropPlugin.daysToMaturity,
          hayOperations: cropPlugin.hayOperations
        }
      : null,
    sprays,
    harvests,
    insecticides,
    cuttings,
    fertilityApps,
    soilTests,
    tasks,
    projected
  };
};
