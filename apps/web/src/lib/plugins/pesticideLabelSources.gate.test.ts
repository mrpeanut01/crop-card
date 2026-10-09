import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { organicInputClass } from '../organic/inputCompliance';
import {
  LABEL_SOURCED_CLASSES,
  pesticideLabelSourceGaps,
  statesAmount,
  traitClaimSourceGaps,
  type LabelSourcePlugin
} from './pesticideLabelSources';
import { hracGroupOf } from '$lib/safety/cropFamilyLethality';
import type { ChemistryClass } from '$lib/safety/types';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/epa-reg-sources.json'), 'utf8')
);

function loadPesticides(): LabelSourcePlugin[] {
  const out: LabelSourcePlugin[] = [];
  for (const dir of ['herbicides', 'insecticides', 'fungicides']) {
    const full = path.join(REPO_ROOT, 'plugins', dir);
    for (const f of readdirSync(full).filter((x) => x.endsWith('.json'))) {
      out.push(JSON.parse(readFileSync(path.join(full, f), 'utf8')));
    }
  }
  return out;
}

function loadCropIds(): Set<string> {
  const full = path.join(REPO_ROOT, 'plugins', 'crops');
  return new Set(
    readdirSync(full)
      .filter((x) => x.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(full, f), 'utf8')).pluginId as string)
  );
}

const base: LabelSourcePlugin = { pluginId: 'x', type: 'herbicide', displayName: 'X' };
const url = 'https://www3.epa.gov/pesticides/chem_search/ppls/000100-00818-20240521.pdf';

describe('pesticide label sources (#640 #661 #716)', () => {
  it('every shipped REI, by-crop PHI and OMRI name is sourced and consistent', () => {
    expect(pesticideLabelSourceGaps(loadPesticides(), SOURCES, loadCropIds())).toEqual([]);
  });

  it('every herbicide with an EPA number carries a label REI, or a reason it cannot', () => {
    const noReiOnLabel: Record<string, string> = {
      crossbow:
        'Label gives no REI hours; its only entry line is "Do not allow people (or pets) to enter the treated area until sprays have dried."',
      'method-aminocyclopyrachlor': 'Non-crop label with no Agricultural Use Requirements box.'
    };
    const missing = loadPesticides()
      .filter(
        (p) =>
          p.type === 'herbicide' &&
          (p as { epaRegistrationNumber?: string }).epaRegistrationNumber &&
          p.reEntryIntervalHours === undefined
      )
      .map((p) => p.pluginId);
    expect(missing.sort()).toEqual(Object.keys(noReiOnLabel).sort());
  });

  it('refuses a herbicide REI with no quote that states the hours', () => {
    const p = { ...base, reEntryIntervalHours: 24 };
    expect(pesticideLabelSourceGaps([p], {})).toHaveLength(1);
    expect(
      pesticideLabelSourceGaps([p], {
        rei: { x: { reEntryIntervalHours: 24, sourceUrl: url, quote: 'REI of 12 hours' } }
      })
    ).toHaveLength(1);
    expect(
      pesticideLabelSourceGaps([p], {
        rei: {
          x: {
            reEntryIntervalHours: 24,
            sourceUrl: url,
            quote: 'restricted-entry interval (REI) of 24 hours'
          }
        }
      })
    ).toEqual([]);
  });

  it('refuses a by-crop PHI with no matching quoted source', () => {
    const p = {
      ...base,
      preHarvestIntervalsByCrop: [{ cropPluginId: 'corn', preHarvestIntervalDays: 21 }]
    };
    expect(pesticideLabelSourceGaps([p], {})).toHaveLength(1);
    expect(
      pesticideLabelSourceGaps([p], {
        phiByCrop: {
          x: [
            {
              cropPluginId: 'corn',
              preHarvestIntervalDays: 21,
              sourceUrl: url,
              quote: 'Do not apply within 210 days'
            }
          ]
        }
      })
    ).toHaveLength(1);
    expect(
      pesticideLabelSourceGaps([p], {
        phiByCrop: {
          x: [
            {
              cropPluginId: 'corn',
              preHarvestIntervalDays: 21,
              sourceUrl: url,
              quote: 'Corn: do not apply within 21 days of harvest'
            }
          ]
        }
      })
    ).toEqual([]);
  });

  it('accepts one quote shared by a list of crop plugins', () => {
    const p = {
      ...base,
      preHarvestIntervalsByCrop: [
        { cropPluginId: 'tomato-a', preHarvestIntervalDays: 5 },
        { cropPluginId: 'tomato-b', preHarvestIntervalDays: 5 },
        { cropFamily: 'corn', preHarvestIntervalDays: 21 }
      ]
    };
    const shared = {
      cropPluginIds: ['tomato-a', 'tomato-b'],
      preHarvestIntervalDays: 5,
      sourceUrl: url,
      quote: 'Tomato ... Do not apply within 5 days of harvest.'
    };
    const corn = {
      cropFamily: 'corn',
      preHarvestIntervalDays: 21,
      sourceUrl: url,
      quote: 'Field Corn ... Do not apply within 21 days of harvest.'
    };
    expect(pesticideLabelSourceGaps([p], { phiByCrop: { x: [shared, corn] } })).toEqual([]);
    expect(
      pesticideLabelSourceGaps([p], {
        phiByCrop: { x: [{ ...shared, cropPluginIds: ['tomato-a'] }, corn] }
      })
    ).toEqual(['x: PHI for tomato-b has no phiByCrop source']);
    // A shared id list never stands in for a family row.
    expect(
      pesticideLabelSourceGaps([p], {
        phiByCrop: { x: [shared, { ...corn, cropFamily: undefined, cropPluginIds: ['corn'] }] }
      })
    ).toEqual(['x: PHI for corn has no phiByCrop source']);
  });

  it('accepts a 0-day PHI quoted as day-of-harvest wording, and no other day count', () => {
    const p = {
      ...base,
      preHarvestIntervalsByCrop: [{ cropPluginId: 'strawberry', preHarvestIntervalDays: 0 }]
    };
    const src = (quote: string) => ({
      phiByCrop: {
        x: [{ cropPluginId: 'strawberry', preHarvestIntervalDays: 0, sourceUrl: url, quote }]
      }
    });
    expect(
      pesticideLabelSourceGaps([p], src('Strawberry ... May be applied the day of harvest.'))
    ).toEqual([]);
    expect(
      pesticideLabelSourceGaps(
        [p],
        src('Strawberry ... can be applied up to and including the day of harvest')
      )
    ).toEqual([]);
    expect(
      pesticideLabelSourceGaps([p], src('Strawberry ... Do not apply within 3 days of harvest.'))
    ).toEqual(['x: phiByCrop source does not quote 0 days for strawberry']);
    const seven = {
      ...base,
      preHarvestIntervalsByCrop: [{ cropPluginId: 'strawberry', preHarvestIntervalDays: 7 }]
    };
    expect(
      pesticideLabelSourceGaps([seven], {
        phiByCrop: {
          x: [
            {
              cropPluginId: 'strawberry',
              preHarvestIntervalDays: 7,
              sourceUrl: url,
              quote: 'Strawberry ... the day of harvest.'
            }
          ]
        }
      })
    ).toEqual(['x: phiByCrop source does not quote 7 days for strawberry']);
  });

  it('keeps a crop plugin row apart from a family row of the same name', () => {
    const p = {
      ...base,
      preHarvestIntervalsByCrop: [
        { cropFamily: 'corn', preHarvestIntervalDays: 49 },
        { cropPluginId: 'corn', preHarvestIntervalDays: 36 }
      ]
    };
    const sources = {
      phiByCrop: {
        x: [
          {
            cropFamily: 'corn',
            preHarvestIntervalDays: 49,
            sourceUrl: url,
            quote: 'Sweet corn ... 49 days before the harvest of fodder'
          },
          {
            cropPluginIds: ['corn'],
            preHarvestIntervalDays: 36,
            sourceUrl: url,
            quote: 'Field corn ... 36 days before the harvest of grain'
          }
        ]
      }
    };
    expect(pesticideLabelSourceGaps([p], sources, new Set(['corn']))).toEqual([]);
  });

  it('reads a PHI stated in whole weeks or split across label lines', () => {
    const p = {
      ...base,
      preHarvestIntervalsByCrop: [
        { cropPluginId: 'peach', preHarvestIntervalDays: 21 },
        { cropPluginId: 'hops', preHarvestIntervalDays: 14 },
        { cropPluginId: 'squash', preHarvestIntervalDays: 0 }
      ]
    };
    const row = (id: string, d: number, quote: string) => ({
      cropPluginId: id,
      preHarvestIntervalDays: d,
      sourceUrl: url,
      quote
    });
    expect(
      pesticideLabelSourceGaps([p], {
        phiByCrop: {
          x: [
            row('peach', 21, 'PEACH ... NOTE: Do not apply three weeks prior to harvest.'),
            row('hops', 14, 'HOPS ... Discontinue use 2 weeks before harvest.'),
            row('squash', 0, 'Squash ... up to and including the day ... of harvest.')
          ]
        }
      })
    ).toEqual([]);
    expect(
      pesticideLabelSourceGaps([p], {
        phiByCrop: {
          x: [
            row('peach', 21, 'PEACH ... Do not apply two weeks prior to harvest.'),
            row('hops', 14, 'HOPS ... Discontinue use 2 weeks before harvest.'),
            row('squash', 0, 'Squash ... up to and including the day ... of harvest.')
          ]
        }
      })
    ).toEqual(['x: phiByCrop source does not quote 21 days for peach']);
  });

  it('refuses a crop listed twice or a crop id that is not in the library', () => {
    const src = {
      cropPluginIds: ['corn'],
      preHarvestIntervalDays: 21,
      sourceUrl: url,
      quote: 'Corn ... Do not apply within 21 days of harvest.'
    };
    const twice = {
      ...base,
      preHarvestIntervalsByCrop: [
        { cropPluginId: 'corn', preHarvestIntervalDays: 21 },
        { cropPluginId: 'corn', preHarvestIntervalDays: 21 }
      ]
    };
    expect(pesticideLabelSourceGaps([twice], { phiByCrop: { x: [src] } })).toEqual([
      'x: PHI for corn is listed twice'
    ]);
    const once = { ...base, preHarvestIntervalsByCrop: [twice.preHarvestIntervalsByCrop[0]] };
    expect(
      pesticideLabelSourceGaps([once], { phiByCrop: { x: [src] } }, new Set(['corn']))
    ).toEqual([]);
    expect(
      pesticideLabelSourceGaps([once], { phiByCrop: { x: [src] } }, new Set(['wheat']))
    ).toEqual(['x: PHI names corn, which is not a crop plugin']);
  });

  it('refuses an OMRI name beside not-allowed flags', () => {
    expect(
      pesticideLabelSourceGaps(
        [
          {
            ...base,
            displayName: 'Thing (OMRI)',
            complianceFlags: { certifiedOrganicAllowed: false }
          }
        ],
        {}
      )
    ).toHaveLength(1);
    expect(
      pesticideLabelSourceGaps([{ ...base, displayName: 'Thing (OMRI)', complianceFlags: {} }], {})
    ).toEqual([]);
  });

  describe('organic-allowed flags need an OMRI listing or a 7 CFR 205 quote (#779)', () => {
    const omri = 'https://www.omri.org/omri-search?query=Thing';
    const listing =
      'Thing WP | Acme Inc. | acm-1234 | NOP | Allowed with Restrictions | expires 2027-03-01';
    const cfr = {
      basis: '7 CFR 205',
      citation: '7 CFR 205.601(e)(5)',
      sourceUrl: 'https://www.ecfr.gov/current/title-7/section-205.601',
      quote: '(5) Elemental sulfur.'
    };

    it('refuses an allowed flag with no source', () => {
      for (const k of ['omriListed', 'certifiedOrganicAllowed', 'transitioningAllowed']) {
        expect(
          pesticideLabelSourceGaps([{ ...base, complianceFlags: { [k]: true } }], {})
        ).toHaveLength(1);
      }
      expect(
        pesticideLabelSourceGaps([{ ...base, complianceFlags: { omriListed: false } }], {})
      ).toEqual([]);
    });

    it('accepts a quoted OMRI NOP listing and refuses a search that found none', () => {
      const p = { ...base, complianceFlags: { omriListed: true, certifiedOrganicAllowed: true } };
      expect(
        pesticideLabelSourceGaps([p], {
          complianceFlags: { x: { omriListed: true, sourceUrl: omri, quote: listing } }
        })
      ).toEqual([]);
      expect(
        pesticideLabelSourceGaps([p], {
          complianceFlags: { x: { omriListed: false, sourceUrl: omri, quote: 'no listing' } }
        })
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], {
          complianceFlags: {
            x: { omriListed: true, sourceUrl: 'https://example.com/omri', quote: listing }
          }
        })
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], {
          complianceFlags: {
            x: { omriListed: true, sourceUrl: omri, quote: 'Thing is OMRI listed' }
          }
        })
      ).toHaveLength(1);
    });

    it('accepts a 7 CFR 205 quote for allowed use but never for omriListed', () => {
      const allowed = {
        ...base,
        complianceFlags: { certifiedOrganicAllowed: true, transitioningAllowed: true }
      };
      expect(pesticideLabelSourceGaps([allowed], { complianceFlags: { x: cfr } })).toEqual([]);
      expect(
        pesticideLabelSourceGaps([{ ...base, complianceFlags: { omriListed: true } }], {
          complianceFlags: { x: cfr }
        })
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([allowed], {
          complianceFlags: { x: { ...cfr, sourceUrl: 'https://example.com/205' } }
        })
      ).toHaveLength(1);
    });

    it('the four OMRI-listed #716 products read as allowed, so they never start the land-transition clock', () => {
      const byId = new Map(loadPesticides().map((p) => [p.pluginId, p]));
      for (const id of ['entrust-sc', 'dipel-df', 'surround-wp', 'pyganic-1-4']) {
        expect(organicInputClass(byId.get(id))).toBe('allowed');
        expect(SOURCES.complianceFlags[id].omriListed).toBe(true);
      }
      for (const id of ['isomate-c-plus-pheromone', 'spear-lep', 'corn-gluten-meal-pre']) {
        expect(organicInputClass(byId.get(id))).toBe('not-marked');
      }
    });
  });

  describe('herbicide default rates (#737 swarm 2026-10-07)', () => {
    const rate = { amount: 32, unit: 'fl-oz' };
    it('refuses a rate with neither a label quote nor rateProvenance fallback', () => {
      expect(pesticideLabelSourceGaps([{ ...base, ratePerAcre: rate }], {})).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([{ ...base, ratePerAcre: rate, rateProvenance: 'fallback' }], {})
      ).toEqual([]);
      expect(pesticideLabelSourceGaps([base], {})).toEqual([]);
    });

    it('refuses a label rate without a quote that states the amount', () => {
      const p = { ...base, ratePerAcre: rate, rateProvenance: 'label' };
      expect(pesticideLabelSourceGaps([p], {})).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], {
          rate: { x: { ratePerAcre: rate, sourceUrl: url, quote: 'Apply 22 fl oz per acre' } }
        })
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], {
          rate: { x: { ratePerAcre: rate, sourceUrl: url, quote: 'Apply 32 fl oz per acre' } }
        })
      ).toEqual([]);
    });

    it('refuses a quoted label rate that is still marked fallback', () => {
      expect(
        pesticideLabelSourceGaps([{ ...base, ratePerAcre: rate, rateProvenance: 'fallback' }], {
          rate: { x: { ratePerAcre: rate, sourceUrl: url, quote: 'Apply 32 fl oz per acre' } }
        })
      ).toHaveLength(1);
    });

    it('refuses a crop rate without a quote stating the amount and maximum', () => {
      const p = {
        ...base,
        ratePerAcreByCrop: [{ cropPluginId: 'corn', amount: 0.5, maxAmount: 1, unit: 'pt' }]
      };
      const src = (quote: string) => ({
        rateByCrop: {
          x: [
            { cropPluginId: 'corn', amount: 0.5, maxAmount: 1, unit: 'pt', sourceUrl: url, quote }
          ]
        }
      });
      expect(pesticideLabelSourceGaps([p], {})).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src('Apply 1 pint per acre'))).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src('Apply 2 pints or 11/2 pint'))).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src('Apply 1 pint, or ½ pint on sand'))).toEqual([]);
      expect(pesticideLabelSourceGaps([p], src('Apply 1 pint, or 1/2 pint on sand'))).toEqual([]);
      expect(
        pesticideLabelSourceGaps([p], {
          rateByCrop: {
            x: [
              {
                cropPluginId: 'wheat',
                amount: 0.5,
                maxAmount: 1,
                unit: 'pt',
                sourceUrl: url,
                quote: '1 or ½'
              }
            ]
          }
        })
      ).toHaveLength(1);
    });

    it('refuses a stage limit that the quote does not contain', () => {
      const p = {
        ...base,
        stageLimitByCrop: [{ cropPluginId: 'wheat', limit: 'Apply before jointing.' }]
      };
      const src = (quote: string) => ({
        stageLimitByCrop: { x: [{ cropPluginId: 'wheat', sourceUrl: url, quote }] }
      });
      expect(pesticideLabelSourceGaps([p], {})).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src('Apply before tillering.'))).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], src('Use 2 oz.  Apply   before\njointing. Do not graze.'))
      ).toEqual([]);
    });

    it('statesAmount reads decimals and label fractions', () => {
      expect(statesAmount('1 ½ pints', 1.5)).toBe(true);
      expect(statesAmount('1 1/2 pints', 1.5)).toBe(true);
      expect(statesAmount('1.5 pints', 1.5)).toBe(true);
      expect(statesAmount('½ pint', 0.5)).toBe(true);
      expect(statesAmount('11/2 pint', 0.5)).toBe(false);
      expect(statesAmount('3/4 pt', 0.75)).toBe(true);
      expect(statesAmount('2 pints', 0.5)).toBe(false);
    });

    it('every shipped herbicide with a default rate marks where it comes from', () => {
      const herbicides = loadPesticides().filter((p) => p.type === 'herbicide' && p.ratePerAcre);
      expect(herbicides.length).toBeGreaterThan(50);
      for (const h of herbicides) expect(['label', 'fallback']).toContain(h.rateProvenance);
    });
  });

  describe('label-sourced chemistry classes (#654)', () => {
    const eptc = {
      ...base,
      activeIngredients: [{ chemistryClass: 'thiocarbamate' }]
    };
    it('the group each label-sourced class must quote is the kernel HRAC group', () => {
      for (const [cls, group] of Object.entries(LABEL_SOURCED_CLASSES)) {
        expect(hracGroupOf(cls as ChemistryClass)).toBe(group);
      }
    });

    it('refuses a thiocarbamate herbicide without a quote that states Group 15', () => {
      expect(pesticideLabelSourceGaps([eptc], {})).toHaveLength(1);
      const entry = { chemistryClass: 'thiocarbamate', hracGroup: 15, sourceUrl: url };
      expect(
        pesticideLabelSourceGaps([eptc], {
          chemistryClass: { x: { ...entry, quote: 'is a Group 150 herbicide' } }
        })
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([eptc], {
          chemistryClass: { x: { ...entry, chemistryClass: 'unclassified', quote: 'Group 15' } }
        })
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([eptc], {
          chemistryClass: { x: { ...entry, quote: 'Eptam 7E is a Group 15 herbicide.' } }
        })
      ).toEqual([]);
    });
  });

  describe('season caps (#820)', () => {
    const cap = {
      cropPluginIds: ['corn', 'popcorn'],
      amount: 1.5,
      unit: 'pt',
      period: 'crop-year'
    };
    const p: LabelSourcePlugin = { ...base, seasonCapByCrop: [cap] };
    const src = (quote: string, over: Record<string, unknown> = {}) => ({
      seasonCapByCrop: {
        x: [
          {
            cropPluginIds: ['popcorn', 'corn'],
            amount: 1.5,
            unit: 'pt',
            period: 'crop-year',
            sourceUrl: url,
            quote,
            ...over
          }
        ]
      }
    });
    const good = 'DO NOT exceed a total of 1 ½ pints per treated acre per crop year.';

    it('accepts a quote that states the amount and the period, crops in any order', () => {
      expect(pesticideLabelSourceGaps([p], src(good), new Set(['corn', 'popcorn']))).toEqual([]);
      expect(
        pesticideLabelSourceGaps(
          [p],
          src('Do not exceed 1 1/2 pints per treated acre per\ncrop year.')
        )
      ).toEqual([]);
    });

    it('refuses a missing source, a different value, or a quote without the amount or period', () => {
      expect(pesticideLabelSourceGaps([p], {})).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src(good, { amount: 2 }))).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src(good, { unit: 'qt' }))).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src(good, { period: 'year' }))).toHaveLength(1);
      expect(pesticideLabelSourceGaps([p], src(good, { cropPluginIds: ['corn'] }))).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], src('DO NOT exceed a total of 2 pints per crop year.'))
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], src('DO NOT exceed a total of 1 ½ pints per season.'))
      ).toHaveLength(1);
      expect(
        pesticideLabelSourceGaps([p], src(good, { sourceUrl: 'http://example.com/x.pdf' }))
      ).toHaveLength(1);
    });

    it('reads each period in the label words', () => {
      const cases: Array<[string, string]> = [
        ['season', 'Do not apply more than a total of 1.5 pt per acre per season.'],
        ['growing-season', 'Do not exceed 1.5 pt per growing season on field corn.'],
        ['year', 'DO NOT exceed 1.5 pt of product per acre per year.'],
        ['365-days', 'Do not exceed a total of 1.5 pt per 365 days for all corn types.']
      ];
      for (const [period, quote] of cases) {
        const q = { ...base, seasonCapByCrop: [{ ...cap, period }] };
        expect(pesticideLabelSourceGaps([q], src(quote, { period }))).toEqual([]);
      }
    });

    it('refuses a crop capped twice or one that is not in the library', () => {
      const twice = { ...base, seasonCapByCrop: [cap, { ...cap, amount: 2 }] };
      expect(
        pesticideLabelSourceGaps([twice], src(good)).filter((g) => g.includes('twice'))
      ).toHaveLength(2);
      expect(pesticideLabelSourceGaps([p], src(good), new Set(['corn']))).toEqual([
        'x: season cap names popcorn, which is not a crop plugin'
      ]);
    });
  });
});

describe('glyphosate trait claims (#720 ruling R720-1)', () => {
  it('every shipped glyphosate trait claim quotes its own PPLS label', () => {
    expect(traitClaimSourceGaps(loadPesticides(), SOURCES)).toEqual([]);
  });

  it('Roundup PowerMAX 3 (master label) carries no trait claim', () => {
    const rpm = loadPesticides().find((p) => p.pluginId === 'roundup-powermax-3') as {
      traitGatedSafeFor?: unknown[];
    };
    expect(rpm.traitGatedSafeFor ?? []).toEqual([]);
  });

  const herb = {
    pluginId: 'g',
    type: 'herbicide',
    epaRegistrationNumber: '100-1182',
    activeIngredients: [{ chemistryClass: 'glyphosate' }],
    traitGatedSafeFor: [{ cropPluginId: 'corn-x', requiresTraits: ['glyphosate-tolerant-rr2'] }]
  };
  const ppls = 'https://www3.epa.gov/pesticides/chem_search/ppls/000100-01182-20150318.pdf';
  const quote = 'may be applied postemergence to Roundup Ready corn';

  it('refuses an unsourced claim, another label, a quote without the use, and stale sources', () => {
    expect(traitClaimSourceGaps([herb], {})).toEqual([
      'g -> corn-x: trait claim has no label source'
    ]);
    expect(
      traitClaimSourceGaps([herb], {
        traitGatedSafeFor: { g: { 'corn-x': { sourceUrl: url, quote } } }
      })
    ).toEqual(["g -> corn-x: source is not the product's own PPLS label"]);
    expect(
      traitClaimSourceGaps([herb], {
        traitGatedSafeFor: { g: { 'corn-x': { sourceUrl: ppls, quote: 'Roundup Ready corn' } } }
      })
    ).toEqual(['g -> corn-x: quote does not state postemergence use over tolerant corn']);
    expect(
      traitClaimSourceGaps([herb], {
        traitGatedSafeFor: {
          g: { 'corn-x': { sourceUrl: ppls, quote }, 'soybean-y': { sourceUrl: ppls, quote } }
        }
      })
    ).toEqual(['g -> soybean-y: source has no matching trait claim']);
  });
});
