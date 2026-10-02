import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { complianceFlagsText, organicInputClass } from './inputCompliance';
import { isProductAllowed, type FilterableInputPlugin } from '$lib/season/philosophyFilter';
import { pluginSchema } from '$lib/plugins/schemas';

const PLUGINS_DIR = path.resolve(__dirname, '../../../../../plugins');
const INPUT_DIRS = ['herbicides', 'insecticides', 'fungicides', 'fertilizers'];

function shippedInputs(): FilterableInputPlugin[] {
  const out: FilterableInputPlugin[] = [];
  for (const dir of INPUT_DIRS) {
    for (const file of readdirSync(path.join(PLUGINS_DIR, dir)).filter((f) =>
      f.endsWith('.json')
    )) {
      const p = pluginSchema.parse(
        JSON.parse(readFileSync(path.join(PLUGINS_DIR, dir, file), 'utf8'))
      );
      if (
        p.type === 'herbicide' ||
        p.type === 'insecticide' ||
        p.type === 'fungicide' ||
        p.type === 'fertilizer'
      ) {
        out.push(p);
      }
    }
  }
  return out;
}

describe('organicInputClass (B-17)', () => {
  const t = 'fertilizer';
  it('reads only the two organic flags', () => {
    expect(organicInputClass(null)).toBe('not-marked');
    expect(organicInputClass(undefined)).toBe('not-marked');
    expect(organicInputClass({ type: t })).toBe('not-marked');
    expect(organicInputClass({ type: t, complianceFlags: {} })).toBe('not-marked');
    expect(organicInputClass({ type: t, complianceFlags: { omriListed: true } })).toBe('allowed');
    expect(organicInputClass({ type: t, complianceFlags: { certifiedOrganicAllowed: true } })).toBe(
      'allowed'
    );
    expect(
      organicInputClass({
        type: t,
        complianceFlags: { omriListed: true, certifiedOrganicAllowed: false }
      })
    ).toBe('not-allowed');
    expect(organicInputClass({ type: t, complianceFlags: { transitioningAllowed: true } })).toBe(
      'not-marked'
    );
    expect(organicInputClass({ type: t, complianceFlags: { nonGmoCompliant: true } })).toBe(
      'not-marked'
    );
    expect(organicInputClass({ type: t, complianceFlags: { omriListed: false } })).toBe(
      'not-marked'
    );
  });

  it('ignores the fertilizer organic-source flag', () => {
    expect(organicInputClass({ type: 'fertilizer', organic: true } as { type: string })).toBe(
      'not-marked'
    );
  });

  it('lists the raw flags as stored', () => {
    expect(complianceFlagsText(undefined)).toBe('');
    expect(complianceFlagsText({ omriListed: false, certifiedOrganicAllowed: true })).toBe(
      'omriListed=false; certifiedOrganicAllowed=true'
    );
  });
});

describe('philosophyFilter agrees with organic records on every shipped plugin (B-18)', () => {
  const plugins = shippedInputs();

  it('loads the shipped input library', () => {
    expect(plugins.length).toBeGreaterThan(200);
  });

  it('certified-organic planner allows only class allowed', () => {
    const bad = plugins
      .filter((p) => isProductAllowed(p, 'certified-organic'))
      .filter((p) => organicInputClass(p) !== 'allowed')
      .map((p) => p.pluginId);
    expect(bad).toEqual([]);
  });

  it('class not-allowed is denied under both organic philosophies', () => {
    const bad = plugins
      .filter((p) => organicInputClass(p) === 'not-allowed')
      .filter(
        (p) =>
          isProductAllowed(p, 'certified-organic') || isProductAllowed(p, 'organic-transitioning')
      )
      .map((p) => p.pluginId);
    expect(bad).toEqual([]);
  });

  it('the five composted or mined fertilizers marked allowed are not "not marked"', () => {
    const marked = plugins.filter(
      (p) =>
        p.type === 'fertilizer' &&
        p.complianceFlags?.certifiedOrganicAllowed === true &&
        p.complianceFlags?.omriListed !== true
    );
    expect(marked.length).toBeGreaterThanOrEqual(5);
    for (const p of marked) expect(organicInputClass(p)).toBe('allowed');
  });

  it('drops the products marked not allowed from transitioning plans', () => {
    const dropped = plugins
      .filter((p) => organicInputClass(p) === 'not-allowed')
      .map((p) => p.pluginId);
    expect(dropped.length).toBeGreaterThanOrEqual(4);
  });
});
