import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import { eventsForPlanting } from '$lib/calendar/engine';
import { dropPlantedSuggestions } from './calendar';

const garlic = {
  pluginId: 'garlic-music-hardneck',
  type: 'crop',
  displayName: 'Garlic — Music',
  version: '1.0.0',
  cropFamily: 'allium',
  seasonalTasks: [
    {
      key: 'garlic-plant',
      kind: 'planting',
      dayOfYear: 295,
      title: 'Plant garlic cloves',
      category: 'plant'
    },
    {
      key: 'garlic-scape-cut',
      kind: 'pruning',
      dayOfYear: 165,
      title: 'Cut scapes',
      category: 'prune'
    }
  ]
} as unknown as CropPlugin;

function planting(at: number): PlantingRecord {
  return {
    id: 'crop-1',
    blockId: 'bed-6',
    cropPluginId: garlic.pluginId,
    varietyDisplayName: 'Music hardneck garlic',
    plantingDate: at,
    status: 'active'
  } as unknown as PlantingRecord;
}

describe('a dated planting is offered once (#622)', () => {
  it('drops the plant-category seasonal row in the planting year', () => {
    const events = eventsForPlanting(planting(Date.UTC(2026, 9, 20)), garlic);
    const seasonal = events.filter((e) => e.kind === 'seasonal-task');
    expect(seasonal.map((e) => e.title)).toEqual(['Cut scapes — Music hardneck garlic']);
    expect(events.filter((e) => e.kind === 'planting')).toHaveLength(1);
  });

  it('hides the planting suggestion once the planting has a plant task', () => {
    const events = eventsForPlanting(planting(Date.UTC(2026, 9, 20)), garlic);
    const kept = dropPlantedSuggestions(events, [{ cropId: 'crop-1', category: 'plant' }]);
    expect(kept.some((e) => e.kind === 'planting')).toBe(false);
    expect(kept.length).toBe(events.length - 1);
    const other = dropPlantedSuggestions(events, [
      { cropId: 'crop-2', category: 'plant' },
      { cropId: 'crop-1', category: 'scout' }
    ]);
    expect(other).toHaveLength(events.length);
  });
});
