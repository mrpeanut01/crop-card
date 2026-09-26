import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isContactOrganic } from './contactOrganic';

function actives(pluginId: string): Array<{ name: string }> {
  const file = path.resolve('../../plugins/herbicides', `${pluginId}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { activeIngredients: Array<{ name: string }> })
    .activeIngredients;
}

describe('isContactOrganic', () => {
  it('recognises the OMRI contact burndowns', () => {
    for (const id of [
      'axxe-ammonium-nonanoate',
      'phydura-clove-citric',
      'suppress-ec',
      'weed-zap-citronella'
    ]) {
      expect(isContactOrganic(actives(id)), id).toBe(true);
    }
  });

  it('leaves systemic herbicides alone', () => {
    expect(isContactOrganic([{ name: '2,4-D amine' }])).toBe(false);
    expect(isContactOrganic([{ name: 'eugenol' }, { name: 'glyphosate' }])).toBe(false);
    expect(isContactOrganic([])).toBe(false);
  });
});
