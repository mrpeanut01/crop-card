import { beforeAll, describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getBaseRegistry } from '$lib/server/registry';
import { eventsForPlanting } from '$lib/calendar/engine';
import { HERB_PLUGIN_IDS } from './herbs';

// R-17: Phase 37B adds sources and the lifecycle verdict, never a data value
// the engine reads, so the engine's output for every herb stays byte for byte.
const PLANTED = Date.UTC(2026, 3, 20);
const READ_AT = Date.UTC(2026, 5, 1);

let crops: Map<string, CropPlugin>;

beforeAll(async () => {
  const registry = await getBaseRegistry();
  crops = new Map(registry.crops().map((c) => [c.pluginId, c]));
}, 60_000);

describe('calendar engine output for every herb', () => {
  it.each(HERB_PLUGIN_IDS.map((id) => [id]))('%s', (id) => {
    const crop = crops.get(id);
    expect(crop, id).toBeDefined();
    const events = eventsForPlanting(
      {
        id: `golden-${id}`,
        blockId: 'block-golden',
        cropPluginId: id,
        varietyDisplayName: crop!.displayName,
        plantingDate: PLANTED
      },
      crop!,
      { blockPlantings: [], companionSystems: [], now: READ_AT, timeZone: 'UTC' }
    );
    expect(events).toMatchSnapshot();
  });
});
