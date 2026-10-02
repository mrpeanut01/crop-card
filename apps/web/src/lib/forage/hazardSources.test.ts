import { describe, expect, it } from 'vitest';
import {
  cropPluginSchema,
  FORAGE_HAZARD_KINDS,
  FORAGE_TRIGGERS,
  forageHazardSchema,
  forageHazardsSchema
} from '$lib/plugins/schemas';
import {
  carryoverDaysQuoteGaps,
  forageHazardGaps,
  type ForageSourceEntry
} from '$lib/plugins/sourceCoverage';
import {
  FORAGE_PLUGIN_EXCLUSIONS,
  FORAGE_TRIGGER_SOURCE_KEYS,
  isPageReaderSource
} from './hazardSources';

const SRC = {
  url: 'https://example.edu/forage.pdf',
  publisher: 'Example Extension',
  date: '2024-01-01',
  quote: 'Sorghum and sudangrass can form prussic acid after a frost.'
};
const PAGE_READER = { ...SRC, note: 'Quoted from the page reader extraction.' };

function entries(overrides: Record<string, ForageSourceEntry> = {}) {
  const base: Record<string, ForageSourceEntry> = {
    'prussicAcid.crops.sorghumFamily': { pluginIds: ['sorghum-x'], sources: [SRC] },
    'prussicAcid.crops.notCyanogenic': { pluginIds: ['millet-x'], sources: [SRC] },
    'nitrate.crops.corn': { pluginIds: ['corn-x', 'sweet-x'], sources: [SRC] }
  };
  for (const kind of FORAGE_HAZARD_KINDS) {
    for (const key of Object.values(FORAGE_TRIGGER_SOURCE_KEYS[kind])) {
      base[key!] = { sources: [SRC] };
    }
  }
  return { ...base, ...overrides };
}

const EXCLUDE = { 'sweet-x': 'Sweet corn, which the source does not mean.' };

const goodCrops = [
  {
    pluginId: 'sorghum-x',
    forageHazards: [
      { kind: 'prussic-acid' as const, triggers: ['frost' as const, 'young-regrowth' as const] }
    ]
  },
  {
    pluginId: 'corn-x',
    forageHazards: [{ kind: 'nitrate' as const, triggers: ['heavy-nitrogen' as const] }]
  },
  { pluginId: 'sweet-x' },
  { pluginId: 'millet-x' }
];

describe('isPageReaderSource', () => {
  it('matches the note research used for HTML extractions', () => {
    expect(isPageReaderSource(PAGE_READER)).toBe(true);
    expect(isPageReaderSource({ note: 'Page Reader text' })).toBe(true);
    expect(isPageReaderSource({})).toBe(false);
    expect(isPageReaderSource({ note: 'PDF, page 3' })).toBe(false);
  });
});

describe('forageHazardGaps (M-23)', () => {
  it('passes a covered library', () => {
    expect(forageHazardGaps(goodCrops, entries(), EXCLUDE)).toEqual([]);
  });

  it('refuses a hazard on a crop no source names', () => {
    const crops = [
      ...goodCrops,
      {
        pluginId: 'oat-x',
        forageHazards: [{ kind: 'nitrate' as const, triggers: ['drought' as const] }]
      }
    ];
    expect(forageHazardGaps(crops, entries(), EXCLUDE)).toEqual([
      'oat-x: nitrate is not named by a shippable source'
    ]);
  });

  it('never counts the not-cyanogenic list as naming a crop', () => {
    const crops = [
      ...goodCrops.filter((c) => c.pluginId !== 'millet-x'),
      {
        pluginId: 'millet-x',
        forageHazards: [{ kind: 'prussic-acid' as const, triggers: ['frost' as const] }]
      }
    ];
    expect(forageHazardGaps(crops, entries(), EXCLUDE)).toEqual([
      'millet-x: prussic-acid is not named by a shippable source'
    ]);
  });

  it('refuses a crop entry backed only by a page-reader source', () => {
    const e = entries({
      'prussicAcid.crops.sorghumFamily': { pluginIds: ['sorghum-x'], sources: [PAGE_READER] }
    });
    expect(forageHazardGaps(goodCrops, e, EXCLUDE)).toEqual([
      'sorghum-x: prussic-acid is not named by a shippable source'
    ]);
  });

  it('refuses a trigger whose entry rests only on a page reader', () => {
    const e = entries({ 'nitrate.drought.afterRain': { sources: [PAGE_READER] } });
    expect(forageHazardGaps(goodCrops, e, EXCLUDE)).toEqual([
      'nitrate drought: nitrate.drought.afterRain has no source that is not a page reader'
    ]);
  });

  it('refuses a trigger with no mapped entry (nitrate after frost)', () => {
    const crops = goodCrops.map((c) =>
      c.pluginId === 'corn-x'
        ? { ...c, forageHazards: [{ kind: 'nitrate' as const, triggers: ['frost' as const] }] }
        : c
    );
    expect(forageHazardGaps(crops, entries(), EXCLUDE)).toEqual([
      'corn-x: nitrate trigger frost has no source'
    ]);
  });

  it('flags a mapped crop that neither carries the hazard nor is excluded', () => {
    expect(forageHazardGaps(goodCrops, entries(), {})).toEqual([
      'sweet-x: named in nitrate.crops.corn but carries no nitrate hazard and is not excluded'
    ]);
  });

  it('flags a stale exclusion and an excluded crop that carries a hazard', () => {
    const crops = goodCrops.map((c) =>
      c.pluginId === 'sweet-x'
        ? { ...c, forageHazards: [{ kind: 'nitrate' as const, triggers: ['drought' as const] }] }
        : c
    );
    expect(
      forageHazardGaps(crops, entries(), { ...EXCLUDE, 'ghost-x': 'Not named anywhere at all.' })
    ).toEqual([
      'sweet-x: excluded but carries forageHazards',
      'ghost-x: excluded but not named in any crop entry'
    ]);
  });

  it('flags a mapped id with no crop plugin', () => {
    const e = entries({
      'nitrate.crops.corn': { pluginIds: ['corn-x', 'sweet-x', 'nope'], sources: [SRC] }
    });
    expect(forageHazardGaps(goodCrops, e, EXCLUDE)).toEqual([
      'nope: named in nitrate.crops.corn but no crop plugin has that id'
    ]);
  });

  it('every shipped exclusion has a real reason', () => {
    for (const [id, reason] of Object.entries(FORAGE_PLUGIN_EXCLUSIONS)) {
      expect(reason.length, id).toBeGreaterThan(10);
      expect(reason, id).not.toMatch(/—/);
    }
  });
});

describe('carryoverDaysQuoteGaps (M-17)', () => {
  const plugin = (n: number) => ({
    pluginId: 'p',
    grazingRestrictions: {
      source: 'label',
      manureCarryover: true,
      manureCarryoverDays: n
    }
  });
  const sources = {
    p: { manureCarryoverDays: { ...SRC, quote: 'Do not use manure within the previous 3 days.' } }
  };

  it('accepts a quote that states the days', () => {
    expect(carryoverDaysQuoteGaps([plugin(3)], sources)).toEqual([]);
  });

  it('refuses a number the quote does not say', () => {
    expect(carryoverDaysQuoteGaps([plugin(13)], sources)).toEqual([
      'p: quote does not say "13 days"'
    ]);
  });

  it('refuses a value with no source', () => {
    expect(carryoverDaysQuoteGaps([plugin(3)], {})).toEqual([
      'p: manureCarryoverDays has no complete source'
    ]);
  });
});

describe('forageHazards schema (M-20)', () => {
  it('accepts every kind with every trigger once', () => {
    for (const kind of FORAGE_HAZARD_KINDS) {
      expect(forageHazardSchema.safeParse({ kind, triggers: [...FORAGE_TRIGGERS] }).success).toBe(
        true
      );
    }
  });

  it('refuses repeats, empties, unknowns and extra keys', () => {
    expect(forageHazardSchema.safeParse({ kind: 'nitrate', triggers: [] }).success).toBe(false);
    expect(
      forageHazardSchema.safeParse({ kind: 'nitrate', triggers: ['frost', 'frost'] }).success
    ).toBe(false);
    expect(forageHazardSchema.safeParse({ kind: 'nitrate', triggers: ['hail'] }).success).toBe(
      false
    );
    expect(forageHazardSchema.safeParse({ kind: 'oxalate', triggers: ['frost'] }).success).toBe(
      false
    );
    expect(
      forageHazardSchema.safeParse({ kind: 'nitrate', triggers: ['frost'], ppm: 1000 }).success
    ).toBe(false);
  });

  it('allows one entry per kind and at most two', () => {
    const n = { kind: 'nitrate', triggers: ['drought'] };
    const p = { kind: 'prussic-acid', triggers: ['frost'] };
    expect(forageHazardsSchema.safeParse([n, p]).success).toBe(true);
    expect(forageHazardsSchema.safeParse([n, n]).success).toBe(false);
    expect(forageHazardsSchema.safeParse([]).success).toBe(false);
  });

  it('is optional on crop plugins and validated when present', () => {
    const shape = cropPluginSchema.shape.forageHazards;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse([{ kind: 'nitrate', triggers: ['drought'] }]).success).toBe(true);
    expect(shape.safeParse([{ kind: 'nitrate', triggers: [] }]).success).toBe(false);
  });
});
