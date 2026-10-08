import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  organicAllowedFlagGaps,
  pesticideLabelSourceGaps,
  type LabelSourcePlugin,
  type OrganicFlagPlugin
} from './pesticideLabelSources';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/epa-reg-sources.json'), 'utf8')
);

function loadPlugins<T>(dirs: readonly string[]): T[] {
  const out: T[] = [];
  for (const dir of dirs) {
    const full = path.join(REPO_ROOT, 'plugins', dir);
    for (const f of readdirSync(full).filter((x) => x.endsWith('.json'))) {
      out.push(JSON.parse(readFileSync(path.join(full, f), 'utf8')));
    }
  }
  return out;
}

function loadPesticides(): LabelSourcePlugin[] {
  return loadPlugins(['herbicides', 'insecticides', 'fungicides']);
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

  describe('organic allowed flags (#779)', () => {
    const omriUrl = 'https://www.omri.org/omri-search?query=Thing';
    const plugin: OrganicFlagPlugin = {
      pluginId: 'x',
      displayName: 'Thing',
      complianceFlags: { omriListed: true, certifiedOrganicAllowed: true }
    };

    it('every shipped input plugin marked allowed for organic use is sourced', () => {
      const plugins = loadPlugins<OrganicFlagPlugin>([
        'herbicides',
        'insecticides',
        'fungicides',
        'fertilizers'
      ]);
      expect(plugins.length).toBeGreaterThan(200);
      expect(organicAllowedFlagGaps(plugins, SOURCES)).toEqual([]);
    });

    it('refuses an allowed flag with no source entry', () => {
      expect(organicAllowedFlagGaps([plugin], {})).toEqual([
        'x: omriListed is true with no OMRI or 7 CFR 205 source',
        'x: certifiedOrganicAllowed is true with no OMRI or 7 CFR 205 source'
      ]);
      expect(
        organicAllowedFlagGaps([{ ...plugin, complianceFlags: { transitioningAllowed: true } }], {})
      ).toHaveLength(1);
    });

    it('accepts only the flags the source records as true', () => {
      const sources = {
        complianceFlags: {
          x: { omriListed: true, sourceUrl: omriUrl, quote: 'Thing | Co | NOP | OMRI listed' }
        }
      };
      expect(organicAllowedFlagGaps([plugin], sources)).toEqual([
        'x: certifiedOrganicAllowed is true with no OMRI or 7 CFR 205 source'
      ]);
      expect(
        organicAllowedFlagGaps([{ ...plugin, complianceFlags: { omriListed: true } }], sources)
      ).toEqual([]);
    });

    it('accepts a complianceFlags data correction to true', () => {
      expect(
        organicAllowedFlagGaps([plugin], {
          dataCorrections: {
            x: [
              {
                path: 'complianceFlags',
                to: { omriListed: true, certifiedOrganicAllowed: true },
                sourceUrl: omriUrl,
                quote: "OMRI NOP listing 'Thing'"
              }
            ]
          }
        })
      ).toEqual([]);
    });

    it('refuses a source that is not OMRI or 7 CFR 205', () => {
      const flags = { omriListed: true };
      const p = { ...plugin, complianceFlags: flags };
      for (const s of [
        { sourceUrl: 'https://example.com/omri', quote: 'OMRI listed' },
        { sourceUrl: 'http://www.omri.org/x', quote: 'OMRI listed' },
        { sourceUrl: omriUrl, quote: '  ' },
        {
          sourceUrl: 'https://www.ecfr.gov/current/title-7/part-205',
          quote: 'OMRI listed'
        },
        { sourceUrl: omriUrl },
        { quote: 'OMRI listed' }
      ]) {
        expect(
          organicAllowedFlagGaps([p], { complianceFlags: { x: { ...flags, ...s } } })
        ).toHaveLength(1);
      }
      expect(
        organicAllowedFlagGaps([p], {
          complianceFlags: {
            x: {
              ...flags,
              sourceUrl: 'https://www.ecfr.gov/current/title-7/section-205.601',
              quote: '§ 205.601 Synthetic substances allowed for use in organic crop production.'
            }
          }
        })
      ).toEqual([]);
    });

    it('refuses an OMRI name or note without a sourced OMRI listing', () => {
      const base = { pluginId: 'x', complianceFlags: {} };
      expect(organicAllowedFlagGaps([{ ...base, displayName: 'Thing (OMRI)' }], {})).toHaveLength(
        1
      );
      expect(
        organicAllowedFlagGaps([{ ...base, displayName: 'Thing', notes: 'OMRI organic.' }], {})
      ).toHaveLength(1);
      expect(organicAllowedFlagGaps([{ ...base, displayName: 'Thing' }], {})).toEqual([]);
      expect(
        organicAllowedFlagGaps([{ ...plugin, displayName: 'Thing (OMRI)' }], {
          complianceFlags: {
            x: {
              omriListed: true,
              certifiedOrganicAllowed: true,
              sourceUrl: omriUrl,
              quote: 'Thing | Co | NOP | Allowed (OMRI)'
            }
          }
        })
      ).toEqual([]);
    });

    it('never reads a false or missing flag as needing a source', () => {
      expect(
        organicAllowedFlagGaps(
          [
            {
              pluginId: 'x',
              displayName: 'Thing',
              complianceFlags: { omriListed: false, certifiedOrganicAllowed: false }
            },
            { pluginId: 'y', displayName: 'Other' }
          ],
          {}
        )
      ).toEqual([]);
    });
  });
});
