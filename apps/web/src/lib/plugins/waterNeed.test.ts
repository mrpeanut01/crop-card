import { describe, expect, it } from 'vitest';
import { cropPluginSchema } from './schemas';
import {
  cropFactPaths,
  cropNameWords,
  isStitchedQuote,
  quoteNamesCropName,
  waterNeedOfQuote,
  waterNeedQuoteGaps,
  waterNeedsOfQuote,
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
    expect(waterNeedQuoteGaps([thyme], sources)).toEqual([
      'thyme-english: waterNeed sources with no value; move them into waterNeed.notRecorded'
    ]);
  });

  it('keeps disagreeing quotes under waterNeed.notRecorded (CO-3)', () => {
    const recorded = (quotes: ReturnType<typeof entry>[]) => ({
      [thyme.pluginId]: {
        'waterNeed.notRecorded': {
          reason: 'Sources disagree on how much water thyme needs.',
          checked: quotes.map((q) => q.url),
          date: '2026-10-21',
          quotes
        }
      }
    });
    const disagree = recorded([
      entry('Thyme prefers dry soil.'),
      entry('Keep thyme in evenly moist soil.')
    ]);
    expect(waterNeedQuoteGaps([thyme], disagree)).toEqual([]);
    expect(waterNeedQuoteGaps([{ ...thyme, waterNeed: 'low' }], disagree)).toEqual([
      'thyme-english: waterNeed is set; drop waterNeed.notRecorded'
    ]);
    const agree = recorded([
      entry('Thyme is drought tolerant.'),
      entry('Thyme grows in dry to medium moisture.')
    ]);
    expect(waterNeedQuoteGaps([thyme], agree)).toEqual([
      'thyme-english: the recorded waterNeed quotes agree on low; ship it'
    ]);
  });

  it('checks an entry even while the field is empty', () => {
    const sources: SourceMap = { [thyme.pluginId]: { waterNeed: entry('Thyme is an herb.') } };
    expect(waterNeedQuoteGaps([thyme], sources)).toEqual([
      'thyme-english: waterNeed sources with no value; move them into waterNeed.notRecorded',
      'thyme-english: waterNeed quote states no single dry, moderate or moist need'
    ]);
  });
});

describe('CO-9 waterNeed gate fixes', () => {
  it('refuses a negated phrase (panel 2 defect 1)', () => {
    expect(waterNeedsOfQuote('Never let the soil dry out.')).toBe('negated');
    expect(waterNeedsOfQuote('Do not allow the soil to dry between waterings.')).toBe('negated');
    expect(waterNeedsOfQuote('Chervil is not drought tolerant.')).toBe('negated');
    expect(waterNeedsOfQuote('Dry soil is not tolerated.')).toBe('negated');
    expect(waterNeedOfQuote('Never let the soil dry out.')).toBeNull();
    const sources: SourceMap = {
      [thyme.pluginId]: {
        waterNeed: entry('Never let thyme sit in soil that is not drought tolerant.')
      }
    };
    expect(waterNeedQuoteGaps([{ ...thyme, waterNeed: 'low' }], sources)).toContain(
      'thyme-english: waterNeed quote negates its water phrase'
    );
  });

  it('does not read a negation in another clause', () => {
    expect(waterNeedsOfQuote('Do not overwater; thyme is drought tolerant.')).toEqual(['low']);
    expect(
      waterNeedsOfQuote(
        'Though rosemary is drought-tolerant once established, it does poorly in wet or poorly drained clay soil.'
      )
    ).toEqual(['low']);
  });

  it('reads a range as every need it spans', () => {
    const nc =
      'Oregano does best in average soil including sandy loams, dry to medium moisture with good drainage, and planted in a site with full sun.';
    expect(waterNeedsOfQuote(nc)).toEqual(['low', 'medium']);
    expect(waterNeedOfQuote(nc)).toBeNull();
    expect(waterNeedsOfQuote('It grows in moist to dry soil.')).toEqual(['low', 'medium', 'high']);
    expect(waterNeedsOfQuote('Grow it in dry to medium moisture; it is drought tolerant.')).toEqual(
      ['low']
    );
  });

  it('ships the one need a range and a single phrase share (oregano)', () => {
    const oregano = { pluginId: 'oregano-greek', displayName: 'Oregano — Greek' } as const;
    const sources: SourceMap = {
      [oregano.pluginId]: {
        waterNeed: entry('Oregano does best in dry to medium moisture with good drainage.'),
        'waterNeed.2': entry('As oregano is drought-tolerant, wait until the soil dries out.')
      }
    };
    expect(waterNeedQuoteGaps([{ ...oregano, waterNeed: 'low' }], sources)).toEqual([]);
    expect(waterNeedQuoteGaps([{ ...oregano, waterNeed: 'medium' }], sources)).toContain(
      'oregano-greek: waterNeed.2 quote reads low, not medium'
    );
    const rangeOnly: SourceMap = {
      [oregano.pluginId]: { waterNeed: sources[oregano.pluginId].waterNeed }
    };
    expect(waterNeedQuoteGaps([{ ...oregano, waterNeed: 'low' }], rangeOnly)).toEqual([
      'oregano-greek: waterNeed sources allow low to medium; leave the field empty'
    ]);
  });

  it('refuses a quote stitched from a heading and a list item (F867-2)', () => {
    const calendula = { pluginId: 'calendula-resina', displayName: 'Calendula Resina' } as const;
    const stitched =
      'Iowa State Yard and Garden FAQ: "Drought tolerant annuals include:"; "pot marigold (Calendula officinalis)"';
    expect(isStitchedQuote(stitched)).toBe(true);
    expect(
      waterNeedQuoteGaps([{ ...calendula, waterNeed: 'low' }], {
        [calendula.pluginId]: { waterNeed: entry(stitched) }
      })
    ).toEqual(['calendula-resina: waterNeed quote joins pieces; it must be one passage (F867-2)']);
    expect(isStitchedQuote('Calendula grows best ... in evenly moist soil.')).toBe(true);
    expect(isStitchedQuote('Calendula grows best in evenly moist soil.')).toBe(false);
  });

  it('keeps the ruled hyssop page-title exception', () => {
    const hyssop = { pluginId: 'hyssop-officinalis', displayName: 'Hyssop (Hyssopus officinalis)' };
    const quote =
      'NC State Plant Toolbox: "Hyssopus officinalis"; "Well-established plants are drought-tolerant as well as resistant to browsing by deer."';
    expect(
      waterNeedQuoteGaps([{ ...hyssop, waterNeed: 'low' }], {
        [hyssop.pluginId]: { waterNeed: entry(quote) }
      })
    ).toEqual([]);
    const other = { pluginId: 'anise-hyssop', displayName: 'Anise Hyssop (Agastache foeniculum)' };
    expect(
      waterNeedQuoteGaps([{ ...other, waterNeed: 'low' }], {
        [other.pluginId]: { waterNeed: entry(quote) }
      })
    ).toContain('anise-hyssop: waterNeed quote joins pieces; it must be one passage (F867-2)');
  });
});

describe('CO-9 quoteNamesCropName', () => {
  it('needs a word boundary after the name', () => {
    expect(
      quoteNamesCropName('Sagebrush grows on dry soil.', 'Sage — Broadleaf (Salvia officinalis)')
    ).toBe(false);
    expect(
      quoteNamesCropName('Sage grows on dry soil.', 'Sage — Broadleaf (Salvia officinalis)')
    ).toBe(true);
    expect(quoteNamesCropName('Plant chives in moist soil.', 'Chives — Common')).toBe(true);
  });

  it('refuses a base name inside a longer herb name', () => {
    expect(quoteNamesCropName('Mountain mint prefers moist soil.', 'Mint — Spearmint')).toBe(false);
    expect(quoteNamesCropName('Mint prefers moist soil.', 'Mint — Spearmint')).toBe(true);
    expect(
      quoteNamesCropName('Mountain mint and mint both like moist soil.', 'Mint — Spearmint')
    ).toBe(true);
    expect(quoteNamesCropName('Holy basil likes moist soil.', 'Basil — Genovese')).toBe(false);
    expect(
      quoteNamesCropName(
        'Russian sage is drought tolerant.',
        'Sage — Broadleaf (Salvia officinalis)'
      )
    ).toBe(false);
    expect(
      quoteNamesCropName(
        'Mountain mint prefers moist soil.',
        'Mountain Mint (Pycnanthemum muticum)'
      )
    ).toBe(true);
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
