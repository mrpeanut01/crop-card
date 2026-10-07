import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pesticideLabelSourceGaps, type LabelSourcePlugin } from './pesticideLabelSources';

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
});
