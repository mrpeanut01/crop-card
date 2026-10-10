import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { organicInputClass } from '../organic/inputCompliance';
import { isProductAllowed } from '../season/philosophyFilter';
import type { FertilizerPlugin } from './schemas';
import { fertilizerOrganicSourceGaps, type LabelSourcePlugin } from './pesticideLabelSources';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/fertilizer-organic-sources.json'), 'utf8')
) as Record<string, unknown>;

function loadFertilizers(): (LabelSourcePlugin & FertilizerPlugin)[] {
  const full = path.join(REPO_ROOT, 'plugins', 'fertilizers');
  return readdirSync(full)
    .filter((x) => x.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(full, f), 'utf8')));
}

const base: LabelSourcePlugin = { pluginId: 'x', type: 'fertilizer', displayName: 'X' };
const cfr = {
  basis: '7 CFR 205',
  citation: '7 CFR 205.601(j)(2)',
  sourceUrl: 'https://www.ecfr.gov/current/title-7/section-205.601',
  quote: '(2) Elemental sulfur.'
};
const listing = {
  omriListed: true,
  sourceUrl: 'https://www.omri.org/omri-search?query=X',
  quote: 'X Granular | X Co. | abc-1234 | NOP | Allowed | expires 2027-06-01'
};

const no = { certifiedOrganicAllowed: false };
const prohibited = {
  certifiedOrganicAllowed: false,
  basis: '7 CFR 205',
  sourceUrl: 'https://www.ecfr.gov/current/title-7/section-205.602'
};
const synthetic = {
  ...prohibited,
  citation: '7 CFR 205.105(a)',
  sourceUrl: 'https://www.ecfr.gov/current/title-7/section-205.105',
  quote: '(a) Synthetic substances and ingredients, except as provided in § 205.601 or § 205.603;',
  definition: {
    citation: '7 CFR 205.2',
    sourceUrl: 'https://www.ecfr.gov/current/title-7/section-205.2',
    quote: 'Synthetic. A substance that is formulated or manufactured by a chemical process'
  },
  inference: 'App inference, not a quote: X is a manufactured fertilizer.'
};

describe('fertilizer organic flag sources (#805, #834)', () => {
  it('every shipped allowed or not-allowed flag and OMRI name is sourced', () => {
    expect(fertilizerOrganicSourceGaps(loadFertilizers(), SOURCES)).toEqual([]);
  });

  it('refuses an allowed flag with no source, and omriListed on a 7 CFR 205 quote', () => {
    const p = { ...base, complianceFlags: { transitioningAllowed: true } };
    expect(fertilizerOrganicSourceGaps([p], {})).toHaveLength(1);
    expect(fertilizerOrganicSourceGaps([p], { x: cfr })).toEqual([]);
    expect(fertilizerOrganicSourceGaps([p], { x: listing })).toEqual([]);
    const omri = { ...base, complianceFlags: { omriListed: true } };
    expect(fertilizerOrganicSourceGaps([omri], { x: cfr })).toHaveLength(1);
    expect(fertilizerOrganicSourceGaps([omri], { x: listing })).toEqual([]);
    expect(
      fertilizerOrganicSourceGaps([p], { x: { ...cfr, sourceUrl: 'https://example.org/' } })
    ).toHaveLength(1);
  });

  it('refuses an OMRI name without omriListed, and a source entry for no plugin', () => {
    expect(fertilizerOrganicSourceGaps([{ ...base, displayName: 'X (OMRI)' }], {})).toHaveLength(1);
    expect(fertilizerOrganicSourceGaps([base], { y: { omriListed: false } })).toEqual([
      'y: source entry names no plugin'
    ]);
  });

  it('generic materials read as the panel ruled (F805-1, F805-2)', () => {
    const byId = new Map(loadFertilizers().map((p) => [p.pluginId, p]));
    const get = (id: string) => byId.get(id)!;
    for (const id of [
      'sulfur-pastille-elemental',
      'fish-emulsion-5-1-1',
      'chilean-nitrate-16-0-0'
    ]) {
      expect(organicInputClass(get(id))).toBe('allowed');
      expect(isProductAllowed(get(id), 'certified-organic')).toBe(false);
      expect(isProductAllowed(get(id), 'organic-transitioning')).toBe(true);
    }
    for (const id of ['blood-meal-12-0-0', 'ag-lime-calcitic', 'liquid-kelp-0-0-1']) {
      expect(organicInputClass(get(id))).toBe('not-marked');
      expect(get(id).displayName).not.toMatch(/OMRI/);
    }
    for (const id of ['soybean-meal-7-1-2', 'cottonseed-meal-6-2-1']) {
      expect(organicInputClass(get(id))).toBe('not-marked');
      expect(get(id).complianceFlags?.nonGmoCompliant).toBe(false);
      expect(get(id).complianceFlags?.notes).toMatch(/GMO/);
    }
    for (const id of [
      'azomite-trace-mineral',
      'polysulphate-mined',
      'sustane-pelleted-poultry-4-6-4',
      'solubor-20-percent-b'
    ]) {
      expect(isProductAllowed(get(id), 'certified-organic')).toBe(true);
    }
  });

  it('a not-allowed mark needs a quoted basis (#834, F834-7)', () => {
    const p = { ...base, displayName: 'Rotenone dust', complianceFlags: no };
    const named = {
      ...prohibited,
      citation: '7 CFR 205.602(f)',
      material: 'rotenone',
      quote: '(f) Rotenone (CAS # 83-79-4).'
    };
    expect(fertilizerOrganicSourceGaps([p], {})).toHaveLength(1);
    expect(fertilizerOrganicSourceGaps([p], { x: cfr })).toHaveLength(1);
    expect(fertilizerOrganicSourceGaps([p], { x: named })).toEqual([]);
    expect(fertilizerOrganicSourceGaps([p], { x: { ...named, material: 'arsenic' } })).toHaveLength(
      1
    );
    expect(
      fertilizerOrganicSourceGaps([{ ...p, displayName: 'KCl' }], {
        x: {
          ...named,
          citation: '7 CFR 205.602(e)',
          material: 'potassium chloride',
          quote: '(e) Potassium chloride—unless derived from a mined source'
        }
      })
    ).toHaveLength(1);
    expect(
      fertilizerOrganicSourceGaps([{ ...p, displayName: 'Potassium chloride' }], {
        x: {
          ...named,
          citation: '7 CFR 205.602(e)',
          material: 'potassium chloride',
          quote: '(e) Potassium chloride—unless derived from a mined source'
        }
      })
    ).toEqual([expect.stringContaining('conditional')]);

    expect(fertilizerOrganicSourceGaps([p], { x: synthetic })).toEqual([]);
    expect(fertilizerOrganicSourceGaps([p], { x: { ...synthetic, inference: '' } })).toHaveLength(
      1
    );
    expect(
      fertilizerOrganicSourceGaps([p], { x: { ...synthetic, definition: undefined } })
    ).toHaveLength(1);
    expect(
      fertilizerOrganicSourceGaps([p], { x: { ...synthetic, citation: '7 CFR 205.203(e)(1)' } })
    ).toHaveLength(1);
  });

  it('refuses a not-allowed mark beside an allowed flag, and a not-allowed source without the mark', () => {
    const both = { ...base, complianceFlags: { ...no, transitioningAllowed: true } };
    expect(fertilizerOrganicSourceGaps([both], { x: synthetic })).not.toEqual([]);
    const allowed = { ...base, complianceFlags: { certifiedOrganicAllowed: true } };
    expect(fertilizerOrganicSourceGaps([allowed], { x: synthetic })).toHaveLength(1);
    expect(fertilizerOrganicSourceGaps([base], { x: synthetic })).toHaveLength(1);
  });

  it('issue #834 marks read as the panel ruled (F834-1 to F834-6)', () => {
    const byId = new Map(loadFertilizers().map((p) => [p.pluginId, p]));
    const get = (id: string) => byId.get(id)!;
    for (const id of [
      'zinc-sulfate-monohydrate',
      'manganese-sulfate-32-percent',
      'copper-sulfate-pentahydrate',
      'potash-mop-0-0-60',
      'calcium-chloride-foliar'
    ]) {
      expect(organicInputClass(get(id))).toBe('allowed');
      expect(get(id).complianceFlags?.omriListed).toBeUndefined();
      expect(isProductAllowed(get(id), 'certified-organic')).toBe(false);
      expect(isProductAllowed(get(id), 'organic-transitioning')).toBe(true);
      const quote = (SOURCES[id] as { quote: string }).quote;
      expect(quote).toContain(get(id).complianceFlags!.notes!);
    }
    for (const id of [
      'k-mag-0-0-22',
      'sop-0-0-50',
      'potassium-nitrate-13-0-44',
      'iron-chelate-feeddha'
    ]) {
      expect(organicInputClass(get(id))).toBe('not-marked');
      expect(isProductAllowed(get(id), 'certified-organic')).toBe(false);
    }
    for (const id of ['urea-46-0-0', 'uan-32', 'dap-18-46-0', 'ammonium-sulfate-21-0-0']) {
      expect(organicInputClass(get(id))).toBe('not-allowed');
      expect(isProductAllowed(get(id), 'organic-transitioning')).toBe(false);
    }
    const restrictions = (SOURCES['solubor-20-percent-b'] as { restrictions: string[] })
      .restrictions;
    expect(get('solubor-20-percent-b').complianceFlags?.notes).toBe(restrictions.join(' '));
  });
});
