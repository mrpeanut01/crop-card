import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { organicInputClass } from '../organic/inputCompliance';
import {
  LABEL_SOURCED_CLASSES,
  pesticideLabelSourceGaps,
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

const base: LabelSourcePlugin = { pluginId: 'x', type: 'herbicide', displayName: 'X' };
const url = 'https://www3.epa.gov/pesticides/chem_search/ppls/000100-00818-20240521.pdf';

describe('pesticide label sources (#640 #661 #716)', () => {
  it('every shipped REI, by-crop PHI and OMRI name is sourced and consistent', () => {
    expect(pesticideLabelSourceGaps(loadPesticides(), SOURCES)).toEqual([]);
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
});
