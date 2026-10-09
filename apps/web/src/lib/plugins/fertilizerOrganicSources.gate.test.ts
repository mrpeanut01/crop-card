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

describe('fertilizer organic flag sources (#805)', () => {
  it('every shipped allowed flag and OMRI name is sourced', () => {
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
    expect(organicInputClass(get('soybean-meal-7-1-2'))).toBe('not-allowed');
    for (const id of [
      'azomite-trace-mineral',
      'polysulphate-mined',
      'sustane-pelleted-poultry-4-6-4'
    ]) {
      expect(isProductAllowed(get(id), 'certified-organic')).toBe(true);
    }
  });
});
