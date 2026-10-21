import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import {
  CROP_PRESERVING_METHODS,
  CROP_PRESERVING_SUITABILITY,
  cropPluginSchema,
  type CropPlugin
} from './schemas';
import {
  checkSources,
  cropFactPaths,
  harvestCadenceQuoteGaps,
  herbHarvestFactPaths,
  preservingQuoteGaps,
  type SourceMap
} from './sourceCoverage';
import { PRESERVING_METHODS, PRESERVING_SUITABILITY } from '$lib/garden/preserving';
import { PRESERVED_AS_METHODS } from '$lib/db/schema';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';
import { HERB_QUOTE_NAMES, quoteNamesCrop } from '$lib/garden/herbQuoteNames';

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

const URL_OK = 'https://extension.example.edu/herbs';
function src(quote: string, url = URL_OK) {
  return { url, publisher: 'Example Extension', date: '2026-10-17', quote };
}
const basil = { pluginId: 'basil-genovese', displayName: 'Basil — Genovese' };

describe('Phase 37C shipped library', () => {
  it('every preserving and harvestCadence value has a source', () => {
    const items = crops.map((c) => ({ pluginId: c.pluginId, paths: herbHarvestFactPaths(c) }));
    expect(checkSources(items, SOURCES)).toEqual([]);
  });

  it('cropFactPaths asks for them', () => {
    for (const c of crops) {
      for (const p of herbHarvestFactPaths(c)) expect(cropFactPaths(c)).toContain(p);
    }
  });

  it('every shipped quote meets the gate rules', () => {
    expect(preservingQuoteGaps(crops, SOURCES)).toEqual([]);
    expect(harvestCadenceQuoteGaps(crops, SOURCES)).toEqual([]);
  });

  it('every source entry under a Phase 37C key belongs to a shipped value', () => {
    const byId = new Map(crops.map((c) => [c.pluginId, c]));
    for (const [id, entries] of Object.entries(SOURCES)) {
      for (const key of Object.keys(entries)) {
        if (!key.startsWith('preserving.') && key !== 'harvestCadence') continue;
        const c = byId.get(id);
        if (key.endsWith('.notRecorded')) {
          const method = key.slice('preserving.'.length, -'.notRecorded'.length);
          expect((entries[key] as { note?: string }).note, `${id} ${key}`).toMatch(/disagree/);
          expect(
            c?.preserving?.some((p) => p.method === method),
            `${id} ${key} is recorded as empty but the plugin has it`
          ).toBeFalsy();
          continue;
        }
        expect(c, `${id} ${key}`).toBeDefined();
        expect(herbHarvestFactPaths(c!), `${id} ${key}`).toContain(key);
      }
    }
  });
});

describe('the method and suitability lists agree everywhere', () => {
  it('plugin schema, preserving.ts and the preserved_as column', () => {
    expect([...CROP_PRESERVING_METHODS]).toEqual([...PRESERVING_METHODS]);
    expect([...PRESERVED_AS_METHODS]).toEqual([...PRESERVING_METHODS]);
    expect([...CROP_PRESERVING_SUITABILITY]).toEqual([...PRESERVING_SUITABILITY]);
  });
});

describe('herb quote names', () => {
  it('cover every herb garden plugin', () => {
    expect(Object.keys(HERB_QUOTE_NAMES).sort()).toEqual([...HERB_PLUGIN_IDS].sort());
  });

  it('match the herb and never a neighbour', () => {
    expect(quoteNamesCrop('Basil leaves turn black when frozen.', basil)).toBe(true);
    const balm = { pluginId: 'lemon-balm', displayName: 'Lemon Balm' };
    expect(quoteNamesCrop('Lemon verbena dries well.', balm)).toBe(false);
    expect(quoteNamesCrop('Lemon balm dries well.', balm)).toBe(true);
    expect(
      quoteNamesCrop('Tomatoes can be frozen.', { pluginId: 'x', displayName: 'Tomato — Roma' })
    ).toBe(true);
  });
});

describe('preservingQuoteGaps', () => {
  function crop(preserving: CropPlugin['preserving']) {
    return { ...basil, preserving };
  }

  it('accepts a quote that names the method and the crop', () => {
    const map = { 'basil-genovese': { 'preserving.dry': src('Basil can be dried in bunches.') } };
    expect(preservingQuoteGaps([crop([{ method: 'dry', suitability: 'good' }])], map)).toEqual([]);
  });

  it('refuses a quote that names neither, or the wrong host', () => {
    const map = {
      'basil-genovese': {
        'preserving.dry': src(
          'Herbs keep their flavor in the freezer.',
          'https://seeds.example.com/x'
        )
      }
    };
    expect(preservingQuoteGaps([crop([{ method: 'dry', suitability: 'good' }])], map)).toEqual([
      'basil-genovese: preserving.dry source is not an extension or government page',
      'basil-genovese: preserving.dry quote does not name the method',
      'basil-genovese: preserving.dry quote does not name the crop'
    ]);
  });

  it('freeze-dried names freeze-dry only', () => {
    const map = {
      'basil-genovese': {
        'preserving.dry': src('Basil can be freeze-dried.'),
        'preserving.freeze-dry': src('Basil can be freeze-dried.')
      }
    };
    expect(
      preservingQuoteGaps(
        [
          crop([
            { method: 'dry', suitability: 'good' },
            { method: 'freeze-dry', suitability: 'good' }
          ])
        ],
        map
      )
    ).toEqual(['basil-genovese: preserving.dry quote does not name the method']);
  });

  it('fair and poor need the source qualifying words', () => {
    const map = {
      'basil-genovese': {
        'preserving.freeze': src('Basil can be frozen.'),
        'preserving.dry': src('Basil does not dry well; it loses most of its flavor.')
      }
    };
    expect(
      preservingQuoteGaps(
        [
          crop([
            { method: 'freeze', suitability: 'fair' },
            { method: 'dry', suitability: 'poor' }
          ])
        ],
        map
      )
    ).toEqual(['basil-genovese: preserving.freeze quote has no words that say fair']);
  });

  it('reads "will mold if not dried quickly" as fair', () => {
    const map = {
      'basil-genovese': {
        'preserving.dry': src('Basil and the mints will mold if not dried quickly.')
      }
    };
    expect(preservingQuoteGaps([crop([{ method: 'dry', suitability: 'fair' }])], map)).toEqual([]);
  });

  it('an infuse row is checked per medium (CO-4)', () => {
    const oil = { method: 'infuse' as const, suitability: 'good' as const, medium: 'oil' as const };
    const ok = {
      'basil-genovese': {
        'preserving.infuse.oil': src('Basil can be kept in infused oils.'),
        'preserving.infuse.oil.safety': src(
          'Clostridium botulinum is of concern in infused oils. Keep them in the refrigerator and discard them 4 days after making them.',
          'https://nchfp.uga.edu/oil'
        )
      }
    };
    expect(preservingQuoteGaps([crop([oil])], ok)).toEqual([]);
    expect(preservingQuoteGaps([crop([{ method: 'infuse', suitability: 'good' }])], ok)).toEqual([
      'basil-genovese: preserving.infuse needs a medium (oil or vinegar)'
    ]);
  });
});

describe('harvestCadenceQuoteGaps', () => {
  const cadence = { everyDays: { min: 14, max: 21 }, from: 'first-cut' as const };
  const crop = { ...basil, harvestCadence: cadence };

  it('accepts both ends as weeks between cuts', () => {
    const map = { 'basil-genovese': { harvestCadence: src('Harvest basil every 2 to 3 weeks.') } };
    expect(harvestCadenceQuoteGaps([crop], map)).toEqual([]);
  });

  it('accepts days', () => {
    const map = {
      'basil-genovese': { harvestCadence: src('Cut basil again 14 to 21 days apart.') }
    };
    expect(harvestCadenceQuoteGaps([crop], map)).toEqual([]);
  });

  it('refuses "a few weeks" and a quote with no interval wording', () => {
    const vague = { 'basil-genovese': { harvestCadence: src('Harvest basil every few weeks.') } };
    expect(harvestCadenceQuoteGaps([crop], vague)).toEqual([
      'basil-genovese: harvestCadence quote does not state 14-21 days'
    ]);
    const few = {
      'basil-genovese': { harvestCadence: src('Basil regrows in a few weeks after a harvest.') }
    };
    expect(harvestCadenceQuoteGaps([crop], few)).toEqual([
      'basil-genovese: harvestCadence quote does not say it is the time between cuts',
      'basil-genovese: harvestCadence quote gives no number ("a few weeks" never counts)'
    ]);
    const oneEnd = { 'basil-genovese': { harvestCadence: src('Harvest basil every 2 weeks.') } };
    expect(harvestCadenceQuoteGaps([crop], oneEnd)).toEqual([
      'basil-genovese: harvestCadence quote does not state 14-21 days'
    ]);
  });
});

describe('crop schema', () => {
  it('refuses two entries for one method and an inverted cadence', () => {
    const preserving = cropPluginSchema.shape.preserving;
    expect(
      preserving.safeParse([
        { method: 'dry', suitability: 'good' },
        { method: 'dry', suitability: 'fair' }
      ]).success
    ).toBe(false);
    expect(
      cropPluginSchema.shape.harvestCadence.safeParse({
        everyDays: { min: 21, max: 14 },
        from: 'first-cut'
      }).success
    ).toBe(false);
  });
});
