import { describe, expect, it } from 'vitest';
import {
  lifecycleQuoteGaps,
  winterHardyToZoneQuoteGaps,
  type SourceMap
} from '$lib/plugins/sourceCoverage';
import { HERB_PLUGIN_IDS } from './herbs';
import {
  LIFECYCLE_QUOTE_NAMES,
  quoteNamesHerb,
  quoteStatesLifecycle,
  quoteStatesZone
} from './lifecycleSources';

const source = (quote: string, url = 'https://pubs.ext.vt.edu/426/426-420/426-420.html') => ({
  url,
  publisher: 'Virginia Cooperative Extension',
  date: '2020',
  quote
});
const REASON = {
  reason:
    'No source fetched in Phase 37; see docs/research/phase-37-herb-research-prompt.md (Task 1)',
  checked: ['https://pubs.ext.vt.edu/426/426-420/426-420.html'],
  date: '2026-10-21'
};

describe('quote helpers', () => {
  it('every herb has quote names', () => {
    expect(HERB_PLUGIN_IDS.filter((id) => !LIFECYCLE_QUOTE_NAMES[id]?.length)).toEqual([]);
    expect(Object.keys(LIFECYCLE_QUOTE_NAMES).sort()).toEqual([...HERB_PLUGIN_IDS].sort());
  });

  it('names a herb on word boundaries, any case, across line breaks', () => {
    expect(quoteNamesHerb('basil-genovese', 'Basil is a tender annual.')).toBe(true);
    expect(quoteNamesHerb('lemon-balm', 'Lemon\nbalm spreads.')).toBe(true);
    expect(quoteNamesHerb('basil-genovese', 'Basilisk')).toBe(false);
    expect(quoteNamesHerb('rosemary-tuscan-blue', 'Thyme is a perennial.')).toBe(false);
    expect(quoteNamesHerb('not-a-herb', 'basil')).toBe(false);
  });

  it('states the lifecycle word or the heading plural', () => {
    expect(quoteStatesLifecycle('perennial', 'Perennials: thyme, sage')).toBe(true);
    expect(quoteStatesLifecycle('annual', 'Basil is an annual')).toBe(true);
    expect(quoteStatesLifecycle('annual', 'Biannual pruning')).toBe(false);
    expect(quoteStatesLifecycle('biennial', 'parsley, a biennial')).toBe(true);
    expect(quoteStatesLifecycle('perennial', 'grown as an annual')).toBe(false);
  });

  it('states the zone with "zone" and the stored number and letter', () => {
    expect(quoteStatesZone('7', 'Hardy in zones 7 to 10.')).toBe(true);
    expect(quoteStatesZone('7', 'Hardy to zone 7b.')).toBe(false);
    expect(quoteStatesZone('7b', 'Hardy to zone 7b.')).toBe(true);
    expect(quoteStatesZone('7b', 'Hardy to zone 7 b.')).toBe(true);
    expect(quoteStatesZone('7a', 'Hardy to zone 7b.')).toBe(false);
    expect(quoteStatesZone('7', 'Hardy in zones 17.')).toBe(false);
    expect(quoteStatesZone('1', 'Hardy in zone 10.')).toBe(false);
    expect(quoteStatesZone('8', 'Hardy to 8 degrees.')).toBe(false);
  });
});

describe('lifecycleQuoteGaps', () => {
  const herb = { pluginId: 'thyme-german-winter', agronomy: { lifecycle: 'perennial' as const } };

  it('passes a herb with a reason and no source', () => {
    expect(
      lifecycleQuoteGaps([herb], { [herb.pluginId]: { 'lifecycle.notRecorded': REASON } })
    ).toEqual([]);
  });

  it('asks a herb with no lifecycle for a reason too', () => {
    expect(lifecycleQuoteGaps([{ pluginId: 'basil-genovese' }], {})).toEqual([
      'basil-genovese: no lifecycle source and no lifecycle.notRecorded reason'
    ]);
  });

  it('ignores crops off the herb list', () => {
    expect(
      lifecycleQuoteGaps(
        [{ pluginId: 'tomato-amish-paste', agronomy: { lifecycle: 'annual' } }],
        {}
      )
    ).toEqual([]);
  });

  it('passes a good quote and refuses a reason left beside it', () => {
    const good: SourceMap = {
      [herb.pluginId]: { lifecycle: source('Thyme is a hardy perennial in Virginia.') }
    };
    expect(lifecycleQuoteGaps([herb], good)).toEqual([]);
    const both: SourceMap = {
      [herb.pluginId]: { ...good[herb.pluginId], 'lifecycle.notRecorded': REASON }
    };
    expect(lifecycleQuoteGaps([herb], both)).toEqual([
      'thyme-german-winter: lifecycle is sourced; drop lifecycle.notRecorded'
    ]);
  });

  it('refuses a seed catalog, a quote naming another crop or another lifecycle', () => {
    const gaps = lifecycleQuoteGaps([herb], {
      [herb.pluginId]: { lifecycle: source('Basil is an annual.', 'https://seeds.example.com/x') }
    });
    expect(gaps).toEqual([
      'thyme-german-winter: lifecycle source is not an extension or government page',
      'thyme-german-winter: lifecycle quote does not name the crop',
      'thyme-german-winter: lifecycle quote does not state perennial'
    ]);
  });

  it('refuses an invalid entry and a source on a herb with no lifecycle', () => {
    expect(lifecycleQuoteGaps([herb], { [herb.pluginId]: { lifecycle: { quote: 'x' } } })).toEqual([
      'thyme-german-winter: lifecycle source is invalid'
    ]);
    expect(
      lifecycleQuoteGaps([{ pluginId: herb.pluginId }], {
        [herb.pluginId]: { lifecycle: source('Thyme is a perennial.') }
      })
    ).toEqual(['thyme-german-winter: lifecycle source but the plugin has no agronomy.lifecycle']);
  });

  it('refuses a reason that is too short', () => {
    expect(
      lifecycleQuoteGaps([herb], { [herb.pluginId]: { 'lifecycle.notRecorded': { reason: 'x' } } })
    ).toHaveLength(1);
  });
});

describe('winterHardyToZoneQuoteGaps', () => {
  const herb = {
    pluginId: 'rosemary-tuscan-blue',
    agronomy: { lifecycle: 'perennial' as const },
    winterHardyToZone: '8'
  };

  it('passes a quote that names the crop and the zone', () => {
    expect(
      winterHardyToZoneQuoteGaps([herb], {
        [herb.pluginId]: { winterHardyToZone: source('Rosemary is hardy in zones 8 to 10.') }
      })
    ).toEqual([]);
  });

  it('refuses a zone on a non-perennial and a quote missing the zone', () => {
    expect(
      winterHardyToZoneQuoteGaps([{ ...herb, agronomy: { lifecycle: 'annual' as const } }], {
        [herb.pluginId]: { winterHardyToZone: source('Rosemary survives most winters.') }
      })
    ).toEqual([
      'rosemary-tuscan-blue: winterHardyToZone on a crop that is not a perennial',
      'rosemary-tuscan-blue: winterHardyToZone quote does not state zone 8'
    ]);
  });

  it('leaves a missing source to checkSources', () => {
    expect(winterHardyToZoneQuoteGaps([herb], {})).toEqual([]);
  });

  it('asks a perennial herb with no zone for a reason, and refuses one beside a zone', () => {
    const noZone = { pluginId: herb.pluginId, agronomy: herb.agronomy };
    expect(winterHardyToZoneQuoteGaps([noZone], {})).toEqual([
      'rosemary-tuscan-blue: perennial with no winterHardyToZone and no winterHardyToZone.notRecorded reason'
    ]);
    expect(
      winterHardyToZoneQuoteGaps([noZone], {
        [herb.pluginId]: { 'winterHardyToZone.notRecorded': REASON }
      })
    ).toEqual([]);
    expect(
      winterHardyToZoneQuoteGaps([herb], {
        [herb.pluginId]: {
          winterHardyToZone: source('Rosemary is hardy in zones 8 to 10.'),
          'winterHardyToZone.notRecorded': REASON
        }
      })
    ).toEqual([
      'rosemary-tuscan-blue: winterHardyToZone is set; drop winterHardyToZone.notRecorded'
    ]);
    expect(
      winterHardyToZoneQuoteGaps(
        [{ pluginId: 'basil-genovese', agronomy: { lifecycle: 'annual' } }],
        {}
      )
    ).toEqual([]);
  });
});
