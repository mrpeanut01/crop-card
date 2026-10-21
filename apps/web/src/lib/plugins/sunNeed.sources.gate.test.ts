import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';
import { SUN_NEEDS, cropPluginSchema } from './schemas';
import {
  SUN_NEED_NOT_RECORDED_KEY,
  SUN_NEED_PHRASES,
  checkSources,
  cropFactPaths,
  sunNeedOfQuote,
  sunNeedQuoteGaps,
  type SourceMap
} from './sourceCoverage';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = path.join(REPO_ROOT, 'apps/web/scripts/crop-data-sources.json');
const cropSources: SourceMap = existsSync(SOURCES)
  ? (JSON.parse(readFileSync(SOURCES, 'utf8')) as SourceMap)
  : {};

let library: PluginRegistry;

beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, path.join(REPO_ROOT, 'plugins'));
});

const URL_OK = 'https://extension.example.edu/herbs/basil';
function src(quote: string, url = URL_OK) {
  return { url, publisher: 'Example Extension', date: '2026-10-21', quote };
}
const basil = { pluginId: 'basil-genovese', displayName: 'Basil — Genovese' };
const reason = {
  reason: 'No allowed page states a ruled sun phrase for this herb.',
  checked: ['https://extension.example.edu/herbs/basil'],
  date: '2026-10-21'
};

describe('CO-5 shipped library', () => {
  it('every sun source reads the stored value, and every herb is filled or explained', () => {
    expect(sunNeedQuoteGaps(library.crops(), cropSources)).toEqual([]);
  });

  it('every shipped sunNeed is in the source coverage check', () => {
    const items = library
      .crops()
      .filter((c) => c.sunNeed)
      .map((c) => ({ pluginId: c.pluginId, paths: cropFactPaths(c) }));
    expect(items.length).toBeGreaterThan(20);
    for (const item of items) expect(item.paths).toContain('sunNeed');
    expect(checkSources(items, cropSources)).toEqual([]);
  });

  it('only herbs carry a sun need, and each herb is filled or has a reason', () => {
    const herbs = new Set(HERB_PLUGIN_IDS);
    for (const c of library.crops()) {
      if (c.sunNeed) expect(herbs.has(c.pluginId), c.pluginId).toBe(true);
    }
    for (const id of HERB_PLUGIN_IDS) {
      const crop = library.crops().find((c) => c.pluginId === id);
      expect(crop, id).toBeDefined();
      if (!crop!.sunNeed) expect(cropSources[id]?.[SUN_NEED_NOT_RECORDED_KEY], id).toBeDefined();
    }
  });
});

describe('sunNeedOfQuote', () => {
  it('reads each ruled phrase', () => {
    for (const need of SUN_NEEDS) {
      for (const phrase of SUN_NEED_PHRASES[need]) {
        expect(sunNeedOfQuote(`Basil grows in ${phrase}.`), phrase).toEqual({
          need,
          negated: false
        });
      }
    }
  });

  it('reads full sun with part shade as part, and part with full shade as shade', () => {
    expect(sunNeedOfQuote('Grows in full sun to partial shade.').need).toBe('part');
    expect(sunNeedOfQuote('Prefers full sun but tolerates some shade.').need).toBe('part');
    expect(sunNeedOfQuote('Light shade to full shade.').need).toBe('shade');
  });

  it('matches longest first, so a longer phrase is never read twice', () => {
    expect(sunNeedOfQuote('Basil tolerates some shade.')).toEqual({ need: 'part', negated: false });
    expect(sunNeedOfQuote('It is shade-tolerant.').need).toBe('part');
  });

  it('reads no phrase as null and words outside the list as nothing', () => {
    expect(sunNeedOfQuote('Basil prefers a sunny location.').need).toBeNull();
    expect(sunNeedOfQuote('Tarragon does better in semishade.').need).toBeNull();
    expect(sunNeedOfQuote('Parsley grows in a partially shaded area.').need).toBeNull();
  });

  it('refuses a negated phrase', () => {
    expect(sunNeedOfQuote('Avoid full shade.')).toEqual({ need: null, negated: true });
    expect(sunNeedOfQuote('Lavender will not grow in partial shade.').negated).toBe(true);
    expect(sunNeedOfQuote('It does not do well in deep shade.').negated).toBe(true);
    expect(sunNeedOfQuote("Basil won't thrive in light shade; give it full sun.")).toEqual({
      need: 'full',
      negated: true
    });
  });

  it('never reads a quote with no ruled phrase as a value', () => {
    const all = Object.values(SUN_NEED_PHRASES).flat();
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        const lower = s.toLowerCase();
        if (all.some((p) => lower.includes(p))) return;
        expect(sunNeedOfQuote(s).need).toBeNull();
      })
    );
  });
});

describe('sunNeedQuoteGaps', () => {
  it('accepts a quote that names the crop and reads the stored value', () => {
    const map = { 'basil-genovese': { sunNeed: src('Basil prefers full sun.') } };
    expect(sunNeedQuoteGaps([{ ...basil, sunNeed: 'full' }], map)).toEqual([]);
  });

  it('refuses the wrong host, an unnamed crop, a negation and a wrong reading', () => {
    const map = {
      'basil-genovese': {
        sunNeed: src('Avoid full shade; it grows in partial shade.', 'https://seeds.example.com/x')
      }
    };
    expect(sunNeedQuoteGaps([{ ...basil, sunNeed: 'full' }], map)).toEqual([
      'basil-genovese: sunNeed source is not an extension or government page',
      'basil-genovese: sunNeed quote does not name the crop',
      'basil-genovese: sunNeed quote negates a sun phrase',
      'basil-genovese: sunNeed quote reads part, not full'
    ]);
  });

  it('stores the sunnier value across sources', () => {
    const map = {
      'basil-genovese': {
        sunNeed: src('Basil grows in full sun to partial shade.'),
        'sunNeed.2': src('Basil prefers full sun.')
      }
    };
    expect(sunNeedQuoteGaps([{ ...basil, sunNeed: 'part' }], map)).toEqual([
      'basil-genovese: a source reads full; store the sunnier value'
    ]);
    const ok = {
      'basil-genovese': {
        sunNeed: src('Basil prefers full sun.'),
        'sunNeed.2': src('Basil grows in full sun to partial shade.')
      }
    };
    expect(sunNeedQuoteGaps([{ ...basil, sunNeed: 'full' }], ok)).toEqual([]);
  });

  it('needs a reasoned notRecorded entry for a herb with no value, and none beside a value', () => {
    expect(sunNeedQuoteGaps([basil], {})).toEqual([
      'basil-genovese: no sunNeed and no sunNeed.notRecorded entry'
    ]);
    expect(
      sunNeedQuoteGaps([basil], { 'basil-genovese': { [SUN_NEED_NOT_RECORDED_KEY]: reason } })
    ).toEqual([]);
    expect(
      sunNeedQuoteGaps([basil], {
        'basil-genovese': {
          [SUN_NEED_NOT_RECORDED_KEY]: { reason: 'short', checked: ['https://x.com/'] }
        }
      })
    ).toEqual([
      'basil-genovese: sunNeed.notRecorded needs a reason, the extension pages checked, a date'
    ]);
    expect(
      sunNeedQuoteGaps([{ ...basil, sunNeed: 'full' }], {
        'basil-genovese': {
          sunNeed: src('Basil prefers full sun.'),
          [SUN_NEED_NOT_RECORDED_KEY]: reason
        }
      })
    ).toEqual(['basil-genovese: sunNeed is set; drop sunNeed.notRecorded']);
  });

  it('refuses sources left behind without a value', () => {
    expect(
      sunNeedQuoteGaps([basil], {
        'basil-genovese': {
          sunNeed: src('Basil prefers full sun.'),
          [SUN_NEED_NOT_RECORDED_KEY]: reason
        }
      })
    ).toEqual(['basil-genovese: sunNeed sources but no sunNeed value']);
  });

  it('asks nothing of a crop that is not an herb', () => {
    expect(
      sunNeedQuoteGaps([{ pluginId: 'tomato-roma', displayName: 'Tomato — Roma' }], {})
    ).toEqual([]);
  });
});

describe('crop schema', () => {
  it('takes the three sun values and nothing else', () => {
    for (const v of SUN_NEEDS)
      expect(cropPluginSchema.shape.sunNeed.safeParse(v).success).toBe(true);
    expect(cropPluginSchema.shape.sunNeed.safeParse('half-day').success).toBe(false);
  });
});
