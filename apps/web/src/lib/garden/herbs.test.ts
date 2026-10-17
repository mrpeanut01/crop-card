import { beforeAll, describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getBaseRegistry } from '$lib/server/registry';
import { HERB_PLUGIN_IDS, isHerbGardenCrop } from './herbs';

let crops: Map<string, CropPlugin>;

beforeAll(async () => {
  const registry = await getBaseRegistry();
  crops = new Map(registry.crops().map((c) => [c.pluginId, c]));
}, 60_000);

const NOT_HERB_ARCHETYPES = new Set([
  'tree-fruit-multi-pick',
  'perennial-vine-quality',
  'small-grain.zadoks',
  'row-grain.pollination'
]);

describe('HERB_PLUGIN_IDS', () => {
  it('has no duplicates', () => {
    expect(new Set(HERB_PLUGIN_IDS).size).toBe(HERB_PLUGIN_IDS.length);
  });

  it('every id resolves in the shipped library', () => {
    const missing = HERB_PLUGIN_IDS.filter((id) => !crops.has(id));
    expect(missing).toEqual([]);
  });

  it('holds every herb-culinary and culinary-herb plugin except strawflower', () => {
    const expected = [...crops.values()]
      .filter((c) => {
        const family: string = c.cropFamily;
        return family === 'herb-culinary' || family === 'culinary-herb';
      })
      .map((c) => c.pluginId)
      .filter((id) => !id.startsWith('strawflower'));
    for (const id of expected) expect(isHerbGardenCrop(id), id).toBe(true);
  });

  it('leaves strawflower out', () => {
    expect(HERB_PLUGIN_IDS.some((id) => id.includes('strawflower'))).toBe(false);
    for (const c of crops.values()) {
      if (c.pluginId.includes('strawflower')) expect(isHerbGardenCrop(c.pluginId)).toBe(false);
    }
  });

  it('lists no tree, vine or grain archetype', () => {
    for (const id of HERB_PLUGIN_IDS) {
      const archetype = (crops.get(id) as { archetype?: string } | undefined)?.archetype;
      expect(NOT_HERB_ARCHETYPES.has(archetype ?? ''), `${id}: ${archetype}`).toBe(false);
    }
  });

  it('answers false for non-herbs and empty input', () => {
    expect(isHerbGardenCrop('tomato-amish-paste')).toBe(false);
    expect(isHerbGardenCrop('parsnip-hollow-crown')).toBe(false);
    expect(isHerbGardenCrop(undefined)).toBe(false);
    expect(isHerbGardenCrop('')).toBe(false);
  });
});
