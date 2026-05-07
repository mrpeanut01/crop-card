import { describe, expect, it } from 'vitest';
import { checkCropCompatibility } from './cropCompatibility';
import type { CropStage, HerbicideProduct } from './types';

const corn: CropStage = { cropPluginId: 'corn-bb', cropFamily: 'corn', heightInches: 6 };
const pumpkin: CropStage = { cropPluginId: 'pumpkin-ezg', cropFamily: 'cucurbit' };
const beans: CropStage = { cropPluginId: 'pole-beans', cropFamily: 'legume' };
const orchard: CropStage = { cropPluginId: 'apple', cropFamily: 'orchard' };

const auxin: HerbicideProduct = {
  pluginId: '24d',
  displayName: '2,4-D',
  activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }]
};

const cleth: HerbicideProduct = {
  pluginId: 'cleth',
  displayName: 'Clethodim',
  activeIngredients: [{ name: 'clethodim', chemistryClass: 'accase-inhibitor' }]
};

const sulfo: HerbicideProduct = {
  pluginId: 'stadia',
  displayName: 'Stadia',
  activeIngredients: [{ name: 'stadia-ai', chemistryClass: 'sulfonylurea' }]
};

const gly: HerbicideProduct = {
  pluginId: 'gly',
  displayName: 'Glyphosate',
  activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }]
};

describe('cropCompatibility', () => {
  it('passes 2,4-D over corn-only block', () => {
    const out = checkCropCompatibility([auxin], corn);
    expect(out).toEqual([]);
  });

  it('blocks 2,4-D when block contains pumpkins (co-planted)', () => {
    const out = checkCropCompatibility([auxin], corn, [pumpkin]);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('CROP_INCOMPATIBLE');
    expect(out[0].detail?.cropFamily).toBe('cucurbit');
    expect(out[0].detail?.isCoPlanted).toBe(true);
  });

  it('blocks 2,4-D when primary crop is a broadleaf companion', () => {
    const out = checkCropCompatibility([auxin], pumpkin);
    expect(out).toHaveLength(1);
    expect(out[0].detail?.isCoPlanted).toBe(false);
  });

  it('blocks Clethodim over corn (kills grasses including corn)', () => {
    const out = checkCropCompatibility([cleth], corn);
    expect(out).toHaveLength(1);
    expect(out[0].detail?.chemistryClass).toBe('accase-inhibitor');
  });

  it('passes Sulfonylurea over corn but blocks over legumes', () => {
    expect(checkCropCompatibility([sulfo], corn)).toEqual([]);
    expect(checkCropCompatibility([sulfo], beans)).toHaveLength(1);
  });

  it('flags glyphosate over any standing crop', () => {
    expect(checkCropCompatibility([gly], corn)).toHaveLength(1);
    expect(checkCropCompatibility([gly], pumpkin)).toHaveLength(1);
    expect(checkCropCompatibility([gly], orchard)).toHaveLength(1);
  });

  it('emits one violation per (product × killed crop) pair', () => {
    const out = checkCropCompatibility([auxin], corn, [pumpkin, beans, orchard]);
    expect(out).toHaveLength(3);
    const families = out.map((v) => v.detail?.cropFamily).sort();
    expect(families).toEqual(['cucurbit', 'legume', 'orchard']);
  });

  it('skips crops with no cropFamily declared (back-compat)', () => {
    const noFamily: CropStage = { cropPluginId: 'unknown' };
    expect(checkCropCompatibility([auxin], noFamily)).toEqual([]);
  });

  it('does not double-count when the same chemistry class appears in multiple ingredients', () => {
    const product: HerbicideProduct = {
      pluginId: 'multi-auxin',
      displayName: 'Mixed auxin',
      activeIngredients: [
        { name: '2,4-D', chemistryClass: 'synthetic-auxin' },
        { name: 'dicamba', chemistryClass: 'synthetic-auxin' }
      ]
    };
    const out = checkCropCompatibility([product], corn, [pumpkin]);
    expect(out).toHaveLength(1);
  });
});
