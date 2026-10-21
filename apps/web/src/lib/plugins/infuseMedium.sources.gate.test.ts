import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { INFUSE_MEDIA, cropPluginSchema, type CropPlugin } from './schemas';
import {
  herbHarvestFactPaths,
  infuseRowGaps,
  preservingQuoteGaps,
  preservingSourceKey,
  type SourceMap
} from './sourceCoverage';
import { INFUSE_OIL_DISCARD_DAYS } from '$lib/garden/infuse';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json'), 'utf8')
) as SourceMap;

let crops: CropPlugin[] = [];
beforeAll(async () => {
  const registry = new PluginRegistry();
  await loadPluginsFromDirectory(registry, path.join(REPO_ROOT, 'plugins'));
  crops = registry.crops();
});

function src(quote: string, url = 'https://extension.example.edu/food') {
  return { url, publisher: 'Example Extension', date: '2026-10-21', quote };
}
const basil = { pluginId: 'basil-genovese', displayName: 'Basil — Genovese' };
const OIL_SAFETY =
  'Clostridium botulinum is of concern in infused oils. Keep them in the refrigerator and discard them 4 days after making them.';
const VINEGAR_SAFETY =
  'For added safety, use only commercially produced vinegars. If your flavored vinegar starts to mold, discard the product. Store flavored vinegars in the refrigerator or cool places.';

describe('CO-4 shipped library', () => {
  it('the three oil rows and the OSU vinegar rows ship, each with its own safety quote', () => {
    const media = (id: string) =>
      (crops.find((c) => c.pluginId === id)?.preserving ?? [])
        .filter((p) => p.method === 'infuse')
        .map((p) => p.medium)
        .sort();
    expect(media('rosemary-tuscan-blue')).toEqual(['oil']);
    expect(media('basil-genovese')).toEqual(['oil', 'vinegar']);
    expect(media('oregano-greek')).toEqual(['oil', 'vinegar']);
    for (const id of [
      'mint-spearmint',
      'tarragon-french',
      'dill-mammoth',
      'chives-common',
      'nasturtium-companion'
    ]) {
      expect(media(id), id).toEqual(['vinegar']);
    }
    expect(media('mountain-mint')).toEqual([]);
  });

  it('no old single-medium key is left', () => {
    for (const [id, entries] of Object.entries(SOURCES)) {
      expect(entries['preserving.infuse'], id).toBeUndefined();
      expect(entries['preserving.infuse.safety'], id).toBeUndefined();
    }
  });

  it('every infuse row passes the medium gate', () => {
    expect(preservingQuoteGaps(crops, SOURCES).filter((g) => g.includes('infuse'))).toEqual([]);
  });

  it('every oil safety quote states the day count the app line uses', () => {
    for (const c of crops) {
      for (const p of c.preserving ?? []) {
        if (p.method !== 'infuse' || p.medium !== 'oil') continue;
        const quote = (SOURCES[c.pluginId]['preserving.infuse.oil.safety'] as { quote: string })
          .quote;
        expect(quote, c.pluginId).toMatch(new RegExp(`\\b${INFUSE_OIL_DISCARD_DAYS} days\\b`));
      }
    }
  });
});

describe('preservingSourceKey and the fact paths', () => {
  it('keys an infuse row by its medium', () => {
    expect(preservingSourceKey({ method: 'dry' })).toBe('preserving.dry');
    expect(preservingSourceKey({ method: 'infuse', medium: 'vinegar' })).toBe(
      'preserving.infuse.vinegar'
    );
    expect(
      herbHarvestFactPaths({
        preserving: [
          { method: 'infuse', suitability: 'good', medium: 'oil' },
          { method: 'infuse', suitability: 'good', medium: 'vinegar' }
        ]
      })
    ).toEqual([
      'preserving.infuse.oil',
      'preserving.infuse.oil.safety',
      'preserving.infuse.vinegar',
      'preserving.infuse.vinegar.safety'
    ]);
  });
});

describe('infuseRowGaps', () => {
  const vinegar = { method: 'infuse', medium: 'vinegar' as const };
  const oil = { method: 'infuse', medium: 'oil' as const };

  it('accepts a vinegar row with the full safety quote', () => {
    const map = {
      'basil-genovese': {
        'preserving.infuse.vinegar': src('Basil is popular for flavored vinegars.'),
        'preserving.infuse.vinegar.safety': src(VINEGAR_SAFETY)
      }
    };
    expect(infuseRowGaps(basil, vinegar, map)).toEqual([]);
  });

  it('refuses a row quote that names the other medium or not its own', () => {
    const map = {
      'basil-genovese': {
        'preserving.infuse.vinegar': src('Basil can be kept in herb oils.'),
        'preserving.infuse.vinegar.safety': src(VINEGAR_SAFETY)
      }
    };
    expect(infuseRowGaps(basil, vinegar, map)).toEqual([
      'basil-genovese: preserving.infuse.vinegar quote does not name vinegar',
      'basil-genovese: preserving.infuse.vinegar quote names oil, the other medium'
    ]);
  });

  it('refuses an oil warning offered as the vinegar safety line', () => {
    const map = {
      'basil-genovese': {
        'preserving.infuse.vinegar': src('Popular herbs for flavored vinegars include basil.'),
        'preserving.infuse.vinegar.safety': src(
          'Botulism is not a concern in flavored vinegars.',
          'https://www.fda.gov/x'
        )
      }
    };
    expect(infuseRowGaps(basil, vinegar, map)).toEqual([
      'basil-genovese: preserving.infuse.vinegar.safety source is not a .edu food-safety page',
      'basil-genovese: preserving.infuse.vinegar.safety quote does not state discard on mold or fermentation',
      'basil-genovese: preserving.infuse.vinegar.safety quote does not state refrigerated or cool storage',
      'basil-genovese: preserving.infuse.vinegar.safety quote does not state commercially produced vinegar'
    ]);
  });

  it('needs the hazard and the control for oil', () => {
    const map = {
      'basil-genovese': {
        'preserving.infuse.oil': src('Basil can be kept in infused oils.'),
        'preserving.infuse.oil.safety': src(
          'Oils provide an anaerobic environment. Clostridium botulinum is of concern.'
        )
      }
    };
    expect(infuseRowGaps(basil, oil, map)).toEqual([
      'basil-genovese: preserving.infuse.oil.safety quote does not state refrigeration',
      'basil-genovese: preserving.infuse.oil.safety quote does not state a time limit'
    ]);
    const ok = {
      'basil-genovese': {
        'preserving.infuse.oil': src('Basil can be kept in infused oils.'),
        'preserving.infuse.oil.safety': src(OIL_SAFETY)
      }
    };
    expect(infuseRowGaps(basil, oil, ok)).toEqual([]);
  });

  it('reads nothing for a method other than infuse', () => {
    expect(infuseRowGaps(basil, { method: 'dry' }, {})).toEqual([]);
  });
});

describe('crop schema', () => {
  const preserving = cropPluginSchema.shape.preserving;

  it('requires a medium on infuse and refuses it elsewhere', () => {
    expect(preserving.safeParse([{ method: 'infuse', suitability: 'good' }]).success).toBe(false);
    expect(
      preserving.safeParse([{ method: 'dry', suitability: 'good', medium: 'oil' }]).success
    ).toBe(false);
    expect(
      preserving.safeParse([{ method: 'infuse', suitability: 'good', medium: 'water' }]).success
    ).toBe(false);
  });

  it('takes one infuse row per medium, never two of one', () => {
    expect(
      preserving.safeParse(
        INFUSE_MEDIA.map((medium) => ({ method: 'infuse', suitability: 'good', medium }))
      ).success
    ).toBe(true);
    expect(
      preserving.safeParse([
        { method: 'infuse', suitability: 'good', medium: 'oil' },
        { method: 'infuse', suitability: 'fair', medium: 'oil' }
      ]).success
    ).toBe(false);
  });

  it('holds every method plus the second medium', () => {
    const rows = [
      { method: 'fresh', suitability: 'good' },
      { method: 'dry', suitability: 'good' },
      { method: 'freeze', suitability: 'good' },
      { method: 'freeze-dry', suitability: 'good' },
      { method: 'infuse', suitability: 'good', medium: 'oil' },
      { method: 'infuse', suitability: 'good', medium: 'vinegar' }
    ];
    expect(preserving.safeParse(rows).success).toBe(true);
  });
});
