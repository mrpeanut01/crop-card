import { describe, expect, it } from 'vitest';
import { checkCropStage } from './cropStage';
import type { CropStage, HerbicideProduct } from './types';

const auxin: HerbicideProduct = {
  pluginId: '24d',
  displayName: '2,4-D',
  activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }]
};
const glypho: HerbicideProduct = {
  pluginId: 'gly',
  displayName: 'glyphosate',
  activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }]
};

function corn(heightInches: number): CropStage {
  return { cropPluginId: 'corn', heightInches };
}

describe('checkCropStage — 2,4-D × corn height', () => {
  it('allows synthetic-auxin on corn ≤ 8"', () => {
    expect(checkCropStage([auxin], corn(8))).toEqual([]);
  });

  it('blocks synthetic-auxin on corn > 8"', () => {
    const v = checkCropStage([auxin], corn(9));
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('CROP_STAGE_BLOCK');
  });

  it('does not block other chemistries on tall corn', () => {
    expect(checkCropStage([glypho], corn(36))).toEqual([]);
  });

  it('does not block synthetic-auxin on a non-corn crop', () => {
    expect(checkCropStage([auxin], { cropPluginId: 'wheat', heightInches: 24 })).toEqual([]);
  });

  it('treats missing height as compliant (<=8 default)', () => {
    expect(checkCropStage([auxin], { cropPluginId: 'corn' })).toEqual([]);
  });
});
