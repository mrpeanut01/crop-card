import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { HARVEST_TIMING_STAGES, cropPluginSchema, type CropPlugin } from './schemas';
import {
  HARVEST_TIMING_NOT_RECORDED_KEY,
  checkSources,
  cropFactPaths,
  harvestTimingFactPaths,
  harvestTimingQuoteGaps,
  type SourceMap
} from './sourceCoverage';
import { isHerbGardenCrop } from '$lib/garden/herbs';

// #867 drying hint (rulings DH-1 to DH-8 in
// docs/design/phase-37-followups/drying-hint.md).

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json'), 'utf8')
) as SourceMap;

let crops: CropPlugin[] = [];
beforeAll(async () => {
  const registry = new PluginRegistry();
  await loadPluginsFromDirectory(registry, PLUGINS_DIR);
  crops = registry
    .all()
    .map((r) => r.plugin)
    .filter((p): p is CropPlugin => p.type === 'crop');
});

const URL_OK = 'https://extension.example.edu/herbs/basil';
function src(quote: string, url = URL_OK) {
  return { url, publisher: 'Example Extension', date: '2026-10-20', quote };
}
type TimingCrop = Pick<CropPlugin, 'pluginId' | 'displayName' | 'harvestTiming'>;
const basil: TimingCrop = {
  pluginId: 'basil-genovese',
  displayName: 'Basil — Genovese',
  harvestTiming: [{ method: 'dry', stage: 'before-bloom' }]
};
function gaps(quote: string, crop: TimingCrop = basil, url = URL_OK) {
  return harvestTimingQuoteGaps([crop], {
    [crop.pluginId]: { 'harvestTiming.dry': src(quote, url) }
  });
}

describe('#867 shipped library', () => {
  it('every harvestTiming row has a source', () => {
    const items = crops.map((c) => ({ pluginId: c.pluginId, paths: harvestTimingFactPaths(c) }));
    expect(checkSources(items, SOURCES)).toEqual([]);
  });

  it('cropFactPaths asks for them', () => {
    for (const c of crops) {
      for (const p of harvestTimingFactPaths(c)) expect(cropFactPaths(c)).toContain(p);
    }
  });

  it('every shipped quote meets the gate rules', () => {
    expect(harvestTimingQuoteGaps(crops, SOURCES)).toEqual([]);
  });

  it('only herbs carry it, and only the sourced ones (DH-5)', () => {
    const carrying = crops
      .filter((c) => c.harvestTiming?.length)
      .map(
        (c) => `${c.pluginId}:${c.harvestTiming!.map((r) => `${r.method}=${r.stage}`).join(',')}`
      )
      .sort();
    expect(carrying).toEqual([
      'basil-genovese:dry=before-bloom',
      'mint-spearmint:dry=bloom-begins',
      'rosemary-tuscan-blue:dry=before-bloom'
    ]);
    for (const c of crops.filter((c) => c.harvestTiming?.length)) {
      expect(isHerbGardenCrop(c.pluginId), c.pluginId).toBe(true);
    }
  });

  it('thyme stays empty because its sources disagree (DH-6)', () => {
    const thyme = crops.find((c) => c.pluginId === 'thyme-german-winter');
    expect(thyme?.harvestTiming).toBeUndefined();
    const reason = (
      SOURCES['thyme-german-winter']?.[HARVEST_TIMING_NOT_RECORDED_KEY] as {
        reason?: string;
      }
    )?.reason;
    expect(reason).toMatch(/disagree/);
  });

  it('every source under a harvestTiming key belongs to a shipped row', () => {
    const byId = new Map(crops.map((c) => [c.pluginId, c]));
    for (const [id, entries] of Object.entries(SOURCES)) {
      for (const key of Object.keys(entries)) {
        if (!key.startsWith('harvestTiming.') || key === HARVEST_TIMING_NOT_RECORDED_KEY) continue;
        const c = byId.get(id);
        expect(c, `${id} ${key}`).toBeDefined();
        expect(harvestTimingFactPaths(c!), `${id} ${key}`).toContain(key);
      }
    }
  });
});

describe('harvestTimingQuoteGaps', () => {
  it('accepts the shipped wordings', () => {
    expect(
      gaps(
        'Where basil is grown for its dried leaves and the extraction of essential or volatile oil, it is cut just prior to the appearance of flowers.'
      )
    ).toEqual([]);
    expect(gaps('Basil ... It is best to cut leaves for drying just before flowers open.')).toEqual(
      []
    );
    expect(gaps('For drying basil, cut sprigs or branches before the plant flowers.')).toEqual([]);
    const mint: TimingCrop = {
      pluginId: 'mint-spearmint',
      displayName: 'Mint — Spearmint',
      harvestTiming: [{ method: 'dry', stage: 'bloom-begins' }]
    };
    expect(
      gaps(
        'Harvesting and using spearmint ... For drying, it is best to cut leaves just as flowering begins.',
        mint
      )
    ).toEqual([]);
    expect(
      gaps(
        'Mint leaves that are to be dried are best taken just as the flowers begin to appear.',
        mint
      )
    ).toEqual([]);
  });

  it('needs the crop, the method and the stage', () => {
    expect(gaps('Prior to blossoming, harvest leaves for drying.')).toEqual([
      'basil-genovese: harvestTiming.dry quote does not name the crop'
    ]);
    expect(gaps('Harvest basil just before it flowers.')).toEqual([
      'basil-genovese: harvestTiming.dry quote does not name the method'
    ]);
    expect(gaps('Basil leaves can be dried for winter use.')).toEqual([
      'basil-genovese: harvestTiming.dry quote does not state before-bloom'
    ]);
    expect(gaps('Freeze-dried basil keeps well; cut it before flowering.')).toEqual([
      'basil-genovese: harvestTiming.dry quote does not name the method'
    ]);
  });

  it('refuses a quote that also states another stage', () => {
    expect(
      gaps(
        'For drying, harvest basil just before flowering or when the first blossoms begin to open.'
      )
    ).toEqual(['basil-genovese: harvestTiming.dry quote also states another stage']);
    expect(gaps('For drying, cut basil before flowering or while in flower.')).toEqual([
      'basil-genovese: harvestTiming.dry quote also states another stage'
    ]);
    expect(gaps('Dried basil is best harvested when in full bloom.')).toEqual([
      'basil-genovese: harvestTiming.dry quote does not state before-bloom',
      'basil-genovese: harvestTiming.dry quote also states another stage'
    ]);
  });

  it('does not read "just before" a bloom stage as the start of bloom', () => {
    const begins: TimingCrop = {
      ...basil,
      harvestTiming: [{ method: 'dry', stage: 'bloom-begins' }]
    };
    expect(gaps('For drying, cut basil just before flowers open.', begins)).toEqual([
      'basil-genovese: harvestTiming.dry quote does not state bloom-begins',
      'basil-genovese: harvestTiming.dry quote also states another stage'
    ]);
  });

  it('needs an extension or government page', () => {
    expect(
      gaps(
        'For drying basil, cut just before the flowers open.',
        basil,
        'https://www.seedcompany.example.com/basil'
      )
    ).toEqual(['basil-genovese: harvestTiming.dry source is not an extension or government page']);
  });

  it('refuses a row on a crop recorded as not recorded', () => {
    const map = {
      'basil-genovese': {
        'harvestTiming.dry': src('For drying basil, cut just before the flowers open.'),
        [HARVEST_TIMING_NOT_RECORDED_KEY]: { reason: 'Sources disagree on before or at bloom.' }
      }
    };
    expect(harvestTimingQuoteGaps([basil], map)).toEqual([
      'basil-genovese: harvestTiming is set; drop harvestTiming.notRecorded'
    ]);
  });
});

describe('harvestTiming schema', () => {
  const shape = cropPluginSchema.shape.harvestTiming;

  it('takes one row per method and the two stages', () => {
    expect([...HARVEST_TIMING_STAGES]).toEqual(['before-bloom', 'bloom-begins']);
    expect(shape.safeParse([{ method: 'dry', stage: 'before-bloom' }]).success).toBe(true);
    expect(
      shape.safeParse([
        { method: 'dry', stage: 'before-bloom' },
        { method: 'dry', stage: 'bloom-begins' }
      ]).success
    ).toBe(false);
    expect(shape.safeParse([{ method: 'dry', stage: 'full-bloom' }]).success).toBe(false);
    expect(shape.safeParse([{ method: 'canning', stage: 'before-bloom' }]).success).toBe(false);
    expect(
      shape.safeParse([{ method: 'dry', stage: 'before-bloom', text: 'Cut it now' }]).success
    ).toBe(false);
    expect(shape.safeParse([]).success).toBe(false);
  });
});
