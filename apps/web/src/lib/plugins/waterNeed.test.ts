import { describe, expect, it } from 'vitest';
import { cropPluginSchema } from './schemas';
import {
  cropFactPaths,
  cropNameWords,
  quoteNamesCropName,
  waterNeedOfQuote,
  waterNeedQuoteGaps,
  type SourceMap
} from './sourceCoverage';

const entry = (quote: string, url = 'https://extension.example.edu/herbs/thyme') => ({
  url,
  publisher: 'Example Extension',
  date: '2026-10-17',
  quote
});

const thyme = { pluginId: 'thyme-english', displayName: 'Thyme — English' } as const;

describe('waterNeedOfQuote', () => {
  it('reads each fixed phrase as its need', () => {
    expect(waterNeedOfQuote('Thyme grows best in dry soil.')).toBe('low');
    expect(waterNeedOfQuote('Give it moderate moisture.')).toBe('medium');
    expect(waterNeedOfQuote('Basil needs evenly moist soil.')).toBe('high');
  });

  it('matches the longest phrase first, so "moderately moist soil" is medium', () => {
    expect(waterNeedOfQuote('Grow in moderately moist soil.')).toBe('medium');
  });

  it('reads nothing, or two needs at once, as no need', () => {
    expect(waterNeedOfQuote('Thyme is a perennial herb.')).toBeNull();
    expect(waterNeedOfQuote('It likes dry soil but also moist soil.')).toBeNull();
  });

  it('does not read a phrase inside a longer word', () => {
    expect(waterNeedOfQuote('Use a drywall saw on dry soilless mix.')).toBeNull();
  });
});

describe('cropNameWords', () => {
  it('takes the name before the variety, its first two words and a binomial', () => {
    expect(cropNameWords('Basil — Genovese')).toEqual(['basil', 'genovese']);
    expect(cropNameWords('Lemon balm, common')).toEqual(['lemon balm']);
    expect(cropNameWords('Marjoram Sweet (Origanum majorana)')).toEqual([
      'marjoram sweet',
      'marjoram',
      'origanum majorana'
    ]);
  });

  it('never names a crop by a generic first word', () => {
    expect(
      quoteNamesCropName('Summer squash likes moist soil.', 'Summer Savory (Satureja hortensis)')
    ).toBe(false);
    expect(
      quoteNamesCropName('Summer savory tolerates drought.', 'Summer Savory (Satureja hortensis)')
    ).toBe(true);
    expect(quoteNamesCropName('Green beans need moist soil.', 'Perilla Green Shiso')).toBe(false);
  });
});

describe('waterNeedQuoteGaps', () => {
  it('passes a quote that names the crop and maps to the stored value', () => {
    const sources: SourceMap = {
      [thyme.pluginId]: { waterNeed: entry('Thyme prefers dry soil.') }
    };
    expect(waterNeedQuoteGaps([{ ...thyme, waterNeed: 'low' }], sources)).toEqual([]);
  });

  it('fails a quote that maps to another value or names another crop', () => {
    const sources: SourceMap = {
      [thyme.pluginId]: { waterNeed: entry('Basil needs evenly moist soil.') }
    };
    const gaps = waterNeedQuoteGaps([{ ...thyme, waterNeed: 'low' }], sources);
    expect(gaps).toContain('thyme-english: waterNeed quote does not name the crop');
    expect(gaps).toContain('thyme-english: waterNeed quote reads high, not low');
  });

  it('fails a source that is not an extension or government page', () => {
    const sources: SourceMap = {
      [thyme.pluginId]: { waterNeed: entry('Thyme prefers dry soil.', 'https://seeds.example.com') }
    };
    expect(waterNeedQuoteGaps([{ ...thyme, waterNeed: 'low' }], sources)).toContain(
      'thyme-english: waterNeed source is not an extension or government page'
    );
  });

  it('empties the field when a second counted source disagrees', () => {
    const sources: SourceMap = {
      [thyme.pluginId]: {
        waterNeed: entry('Thyme prefers dry soil.'),
        'waterNeed.2': entry('Keep thyme in evenly moist soil.')
      }
    };
    const gaps = waterNeedQuoteGaps([{ ...thyme, waterNeed: 'low' }], sources);
    expect(gaps).toContain('thyme-english: waterNeed sources disagree; leave the field empty');
    expect(waterNeedQuoteGaps([thyme], sources)).toEqual([]);
  });

  it('checks an entry even while the field is empty', () => {
    const sources: SourceMap = { [thyme.pluginId]: { waterNeed: entry('Thyme is an herb.') } };
    expect(waterNeedQuoteGaps([thyme], sources)).toEqual([
      'thyme-english: waterNeed quote states no single dry, moderate or moist need'
    ]);
  });
});

describe('waterNeed on the crop schema', () => {
  const base = {
    pluginId: 'thyme-english',
    type: 'crop',
    displayName: 'Thyme — English',
    version: '1.0.0',
    cropFamily: 'herb-culinary',
    harvestStyle: 'cut-and-come-again',
    bloomWindow: { daysFromPlantingMin: 60, daysFromPlantingMax: 90, beeAttractive: true }
  };

  it('is optional and limited to low, medium or high', () => {
    expect(cropPluginSchema.safeParse(base).success).toBe(true);
    expect(cropPluginSchema.safeParse({ ...base, waterNeed: 'low' }).success).toBe(true);
    expect(cropPluginSchema.safeParse({ ...base, waterNeed: 'damp' }).success).toBe(false);
  });

  it('asks for a waterNeed source only when the value is set', () => {
    expect(cropFactPaths(cropPluginSchema.parse(base))).not.toContain('waterNeed');
    expect(cropFactPaths(cropPluginSchema.parse({ ...base, waterNeed: 'high' }))).toContain(
      'waterNeed'
    );
  });
});
