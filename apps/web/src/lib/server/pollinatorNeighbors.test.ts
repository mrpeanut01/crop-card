import { describe, expect, it } from 'vitest';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { pollinatorNeighbors } from './pollinatorNeighbors';

const AT = Date.parse('2026-06-21T16:00:00Z');
const DAY = 86_400_000;
const square = (lat: number, lon: number) =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + 0.0002, lat],
        [lon + 0.0002, lat + 0.0002],
        [lon, lat + 0.0002]
      ]
    ]
  });

function blk(
  id: string,
  geometryGeojson: string | undefined,
  plantings: Array<[string, number | null]>
): BlockWithPlantings {
  return {
    id,
    name: id,
    geometryGeojson,
    plantings: plantings.map(([cropPluginId, plantingDate], i) => ({
      id: `${id}-${i}`,
      blockId: id,
      cropPluginId,
      varietyDisplayName: `${cropPluginId} (variety)`,
      plantingDate
    }))
  } as BlockWithPlantings;
}

const PLUGINS: Record<string, Partial<CropPlugin>> = {
  squash: { displayName: 'Squash', bloomWindow: { continuous: true, beeAttractive: true } },
  apple: { displayName: 'Apple', bloomWindow: { monthsOfYear: [4, 5], beeAttractive: true } },
  wheat: { displayName: 'Wheat', bloomWindow: { monthsOfYear: [5, 6], beeAttractive: false } }
};
const lookup = (id: string) => (PLUGINS[id] as CropPlugin | undefined) ?? null;

describe('pollinatorNeighbors', () => {
  const blocks = [
    blk('treated', square(39.1, -77.5), [['squash', AT - 60 * DAY]]),
    blk('orchard', square(39.105, -77.5), [['apple', AT - 400 * DAY]]),
    blk('squash', square(39.101, -77.5), [['squash', AT - 60 * DAY]]),
    blk('planned', square(39.101, -77.5), [
      ['squash', null],
      ['squash', AT + 10 * DAY]
    ]),
    blk('grain', undefined, [['wheat', AT - 200 * DAY]])
  ];

  it('excludes the treated block and blocks with no planted crops', () => {
    const out = pollinatorNeighbors('treated', blocks, lookup, AT);
    expect(out.map((n) => n.blockId)).toEqual(['orchard', 'squash', 'grain']);
  });

  it('flags bloom-now and bee-attractive from the crop plugin bloom window', () => {
    const out = pollinatorNeighbors('treated', blocks, lookup, AT);
    const by = Object.fromEntries(out.map((n) => [n.blockId, n.crops[0]]));
    expect(by.orchard).toMatchObject({
      displayName: 'Apple',
      inBloomNow: false,
      beeAttractive: true
    });
    expect(by.squash).toMatchObject({ inBloomNow: true, beeAttractive: true });
    expect(by.grain).toMatchObject({ inBloomNow: false, beeAttractive: false });
  });

  it('measures centroid distance and returns null without geometry', () => {
    const out = pollinatorNeighbors('treated', blocks, lookup, AT);
    const d = Object.fromEntries(out.map((n) => [n.blockId, n.distanceFt]));
    expect(d.squash).toBeGreaterThan(300);
    expect(d.squash).toBeLessThan(450);
    expect(d.orchard as number).toBeGreaterThan(d.squash as number);
    expect(d.grain).toBeNull();
  });

  it('returns nothing when the treated block is not in the list', () => {
    expect(pollinatorNeighbors('other-owner-block', blocks, lookup, AT)).toEqual([]);
  });
});
