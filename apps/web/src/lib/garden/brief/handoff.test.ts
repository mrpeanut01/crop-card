import { describe, expect, it } from 'vitest';
import {
  BRIEF_SEED_PREFIX,
  briefPetSpecies,
  briefWizardSeeds,
  designerCropsParam,
  isBriefSeedId,
  parseDesignerCrops
} from './handoff';

const catalog = [
  { pluginId: 'basil-genovese', displayName: 'Basil — Genovese', cropFamily: 'herb-culinary' },
  { pluginId: 'chives-common', displayName: 'Chives', cropFamily: 'herb-culinary' }
];

describe('briefWizardSeeds', () => {
  it('picks a linked seed lot and adds a placeholder counted in plants otherwise', () => {
    const lot = {
      stockItemId: 'st_1',
      displayName: 'Basil seed',
      onHand: 10,
      defaultUnit: 'seeds',
      cropPluginId: 'basil-genovese',
      cropFamily: 'herb-culinary'
    };
    const out = briefWizardSeeds(
      [
        { cropPluginId: 'basil-genovese' },
        { cropPluginId: 'chives-common' },
        { cropPluginId: 'nope' }
      ],
      [lot],
      catalog
    );
    expect(out.preselect).toEqual(['st_1', `${BRIEF_SEED_PREFIX}chives-common`]);
    expect(out.extra).toEqual([
      {
        stockItemId: 'brief:chives-common',
        displayName: 'Chives',
        onHand: 0,
        onOrder: 0,
        planned: 0,
        defaultUnit: 'count',
        cropPluginId: 'chives-common',
        cropFamily: 'herb-culinary'
      }
    ]);
    expect(out.seedlingCrops).toEqual(['basil-genovese', 'chives-common']);
    expect(isBriefSeedId(out.extra[0].stockItemId)).toBe(true);
    expect(isBriefSeedId('st_1')).toBe(false);
  });
});

describe('designer crops param', () => {
  it('round-trips and refuses junk', () => {
    const param = designerCropsParam([
      { cropPluginId: 'a-1' },
      { cropPluginId: 'b' },
      { cropPluginId: 'a-1' }
    ]);
    expect(param).toBe('a-1,b');
    expect(parseDesignerCrops(param)).toEqual(['a-1', 'b']);
    expect(parseDesignerCrops('Bad Id,<x>,ok')).toEqual(['ok']);
    expect(parseDesignerCrops(null)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `h${i}`).join(',');
    expect(parseDesignerCrops(many)).toHaveLength(12);
  });
});

describe('briefPetSpecies', () => {
  it('checks pets and chickens only (R-27)', () => {
    expect(briefPetSpecies([])).toEqual([]);
    expect(briefPetSpecies(['animals'])).toEqual([]);
    expect(briefPetSpecies(['pets', 'chickens'])).toEqual([
      'dog',
      'cat',
      'rabbit',
      'chicken',
      'duck'
    ]);
  });
});
