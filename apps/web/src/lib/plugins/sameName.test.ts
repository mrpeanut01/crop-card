import { describe, expect, it } from 'vitest';
import { sameNameDetails } from './sameName';

describe('sameNameDetails (#658)', () => {
  it('names the active ingredient when two entries share a name', () => {
    expect(
      sameNameDetails([
        {
          pluginId: '2-4-d-amine',
          displayName: '2,4-D Amine',
          activeIngredients: [{ name: '2,4-D dimethylamine salt' }]
        },
        { pluginId: '24d', displayName: '2,4-D Amine', activeIngredients: [{ name: '2,4-D' }] },
        { pluginId: 'roundup', displayName: 'Roundup', activeIngredients: [{ name: 'glyphosate' }] }
      ])
    ).toEqual(['2,4-D dimethylamine salt', '2,4-D', null]);
  });

  it('falls back to the library id when the ingredients do not tell them apart', () => {
    expect(
      sameNameDetails([
        {
          pluginId: 'clethodim',
          displayName: 'Clethodim 2EC',
          activeIngredients: [{ name: 'clethodim' }]
        },
        {
          pluginId: 'clethodim-2e',
          displayName: 'clethodim 2ec',
          activeIngredients: [{ name: 'clethodim' }]
        }
      ])
    ).toEqual(['clethodim', 'clethodim-2e']);
  });
});
