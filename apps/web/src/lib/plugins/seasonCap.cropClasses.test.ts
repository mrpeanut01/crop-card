/**
 * #820 ruling SC-5: label season caps name every library crop plugin that
 * clearly falls in the label's crop class, so a new corn plugin must be
 * classified before it ships, or a cap could silently skip it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

type CornClass = 'field' | 'sweet' | 'pop' | 'excluded';

/** Every shipped corn-family crop plugin. `excluded` is ornamental, flint
 *  and flour corn and test fixtures, which no label class names clearly. */
const CORN_CLASSES: Record<string, CornClass> = {
  'corn-feed-dent-pioneer': 'field',
  'corn-bloody-butcher': 'field',
  corn: 'field',
  'corn-bantam-sweet': 'sweet',
  'corn-sweet-bodacious': 'sweet',
  'sweet-corn-american-dream-f1-seed': 'sweet',
  'sweet-corn-anthem-xr-standard-cruiser-1-000-seeds': 'sweet',
  'sweet-corn-honey-select-f1': 'sweet',
  'sweet-corn-mirai-f1': 'sweet',
  'sweet-corn-silver-queen-f1': 'sweet',
  'sweet-corn-sugar-buns-f1': 'sweet',
  'popcorn-strawberry': 'pop',
  'popcorn-top-pop-f1-seed-standard-treated-100-seeds': 'pop',
  'corn-painted-mountain': 'excluded',
  'ornamental-corn-earth-tones-dent-raw-untreated-non-gmo': 'excluded',
  'ornamental-corn-oxacana-green-dent': 'excluded',
  'bloody-butcher-ornamental-corn-raw-untreated-non-gmo-1-2-lb': 'excluded',
  'test-corn-variety-ct-001': 'excluded'
};

/** The corn classes each capped herbicide's label sentence covers. */
const CORN_CAPS: Record<string, Array<{ amount: number; classes: CornClass[] }>> = {
  banvel: [{ amount: 1.5, classes: ['field', 'pop'] }],
  callisto: [{ amount: 6, classes: ['field', 'sweet'] }],
  laudis: [
    { amount: 6, classes: ['field', 'pop'] },
    { amount: 3, classes: ['sweet'] }
  ],
  'capreno-thiencarbazone-tembotrione': [
    { amount: 6, classes: ['field', 'pop'] },
    { amount: 3, classes: ['sweet'] }
  ]
};

function readDir(dir: string): Array<Record<string, unknown>> {
  const full = path.join(REPO_ROOT, 'plugins', dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(full, f), 'utf8')));
}

describe('season cap corn classes (#820 SC-5)', () => {
  const crops = readDir('crops');
  const cornIds = crops.filter((c) => c.cropFamily === 'corn').map((c) => c.pluginId as string);

  it('every shipped corn plugin is classified, and every classified id ships', () => {
    expect(cornIds.filter((id) => !(id in CORN_CLASSES))).toEqual([]);
    expect(Object.keys(CORN_CLASSES).filter((id) => !cornIds.includes(id))).toEqual([]);
  });

  it('each corn cap names exactly the plugins of its label classes', () => {
    const herbicides = new Map(readDir('herbicides').map((h) => [h.pluginId as string, h]));
    for (const [pluginId, caps] of Object.entries(CORN_CAPS)) {
      const rows = (herbicides.get(pluginId)?.seasonCapByCrop ?? []) as Array<{
        cropPluginIds: string[];
        amount: number;
      }>;
      for (const cap of caps) {
        const want = Object.entries(CORN_CLASSES)
          .filter(([, cls]) => cap.classes.includes(cls))
          .map(([id]) => id)
          .sort();
        const row = rows.find((r) => r.amount === cap.amount);
        expect(row, `${pluginId} ${cap.amount}`).toBeDefined();
        expect(
          row!.cropPluginIds.filter((id) => id in CORN_CLASSES).sort(),
          `${pluginId} ${cap.amount}`
        ).toEqual(want);
      }
    }
  });

  it('no herbicide caps an excluded corn plugin', () => {
    const excluded = new Set(
      Object.entries(CORN_CLASSES)
        .filter(([, cls]) => cls === 'excluded')
        .map(([id]) => id)
    );
    for (const h of readDir('herbicides')) {
      for (const row of (h.seasonCapByCrop ?? []) as Array<{ cropPluginIds: string[] }>) {
        expect(row.cropPluginIds.filter((id) => excluded.has(id))).toEqual([]);
      }
    }
  });
});
