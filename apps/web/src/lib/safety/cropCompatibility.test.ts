import { describe, expect, it } from 'vitest';
import { checkCropCompatibility } from './cropCompatibility';
import type { CropIncompatibilityCrop, CropStage, HerbicideProduct } from './types';

function crops(v: { detail?: Record<string, unknown> } | undefined): CropIncompatibilityCrop[] {
  return (v?.detail?.crops as CropIncompatibilityCrop[]) ?? [];
}

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
    expect(crops(out[0])).toEqual([
      { cropPluginId: 'pumpkin-ezg', cropFamily: 'cucurbit', isCoPlanted: true }
    ]);
  });

  it('blocks 2,4-D when primary crop is a broadleaf companion', () => {
    const out = checkCropCompatibility([auxin], pumpkin);
    expect(out).toHaveLength(1);
    expect(crops(out[0])[0].isCoPlanted).toBe(false);
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

  it('emits one consolidated violation per (product × chemistry class) listing every affected crop', () => {
    const out = checkCropCompatibility([auxin], corn, [pumpkin, beans, orchard]);
    expect(out).toHaveLength(1);
    expect(out[0].detail?.chemistryClass).toBe('synthetic-auxin');
    const families = crops(out[0])
      .map((c) => c.cropFamily)
      .sort();
    expect(families).toEqual(['cucurbit', 'legume', 'orchard']);
    expect(out[0].message).toContain('cucurbit, legume, orchard');
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

describe('Phase 9 — new crop families × chemistry kill matrix', () => {
  const tomato: CropStage = { cropPluginId: 'tomato-roma', cropFamily: 'solanaceae' };
  const cabbage: CropStage = { cropPluginId: 'cabbage-savoy', cropFamily: 'brassica' };
  const onion: CropStage = { cropPluginId: 'onion-storage', cropFamily: 'allium' };
  const lettuce: CropStage = { cropPluginId: 'lettuce-leaf', cropFamily: 'leafy-green' };
  const carrot: CropStage = { cropPluginId: 'carrot-nantes', cropFamily: 'root' };
  const celery: CropStage = { cropPluginId: 'celery', cropFamily: 'apiaceae' };
  const blueberry: CropStage = { cropPluginId: 'blueberry-bluecrop', cropFamily: 'small-fruit' };
  const raspberry: CropStage = { cropPluginId: 'raspberry-heritage', cropFamily: 'bramble' };
  const _grape: CropStage = { cropPluginId: 'grape-concord', cropFamily: 'vine-fruit' };
  const peach: CropStage = { cropPluginId: 'peach-redhaven', cropFamily: 'stone-fruit' };
  const wheat: CropStage = { cropPluginId: 'wheat-soft-red', cropFamily: 'cereal-grain' };
  const alfalfa: CropStage = { cropPluginId: 'alfalfa', cropFamily: 'forage' };
  const basil: CropStage = { cropPluginId: 'basil-genovese', cropFamily: 'herb-culinary' };

  const pendi: HerbicideProduct = {
    pluginId: 'prowl',
    displayName: 'Prowl H2O',
    activeIngredients: [{ name: 'pendimethalin', chemistryClass: 'microtubule-inhibitor' }]
  };
  const atrazine: HerbicideProduct = {
    pluginId: 'atrazine',
    displayName: 'Atrazine 4L',
    activeIngredients: [{ name: 'atrazine', chemistryClass: 'photosystem-ii-triazine' }]
  };
  const paraquat: HerbicideProduct = {
    pluginId: 'gramoxone',
    displayName: 'Gramoxone SL',
    activeIngredients: [{ name: 'paraquat', chemistryClass: 'photosystem-i-diquat' }]
  };
  const liberty: HerbicideProduct = {
    pluginId: 'liberty',
    displayName: 'Liberty 280 SL',
    activeIngredients: [{ name: 'glufosinate', chemistryClass: 'glufosinate' }]
  };
  const reflex: HerbicideProduct = {
    pluginId: 'reflex',
    displayName: 'Reflex',
    activeIngredients: [{ name: 'fomesafen', chemistryClass: 'ppo-inhibitor' }]
  };
  const pursuit: HerbicideProduct = {
    pluginId: 'pursuit',
    displayName: 'Pursuit',
    activeIngredients: [{ name: 'imazethapyr', chemistryClass: 'als-imidazolinone' }]
  };
  const command: HerbicideProduct = {
    pluginId: 'command',
    displayName: 'Command 3ME',
    activeIngredients: [{ name: 'clomazone', chemistryClass: 'clomazone' }]
  };

  it('blocks atrazine over solanaceae / leafy-green / forage', () => {
    expect(checkCropCompatibility([atrazine], tomato)).toHaveLength(1);
    expect(checkCropCompatibility([atrazine], lettuce)).toHaveLength(1);
    expect(checkCropCompatibility([atrazine], alfalfa)).toHaveLength(1);
    // Note: orchard / vine-fruit are NOT in triazine kill list — Princep (simazine)
    // is labeled for orchard floor + vineyard row use under established perennials.
    // Foliar drift onto grape is still a real risk but the kernel handles it via
    // sprayer-state cross-contam, not the kill matrix.
  });

  it('blocks pendimethalin over alliums (shallow + bulb-sensitive)', () => {
    expect(checkCropCompatibility([pendi], onion)).toHaveLength(1);
    // Cereals + forage are NOT in microtubule kill list — Prowl H2O / Treflan are
    // label-tolerant on corn, soybean, wheat, alfalfa via deep seedbed placement.
    expect(checkCropCompatibility([pendi], wheat)).toEqual([]);
    expect(checkCropCompatibility([pendi], alfalfa)).toEqual([]);
  });

  it('passes pendimethalin over solanaceae / brassica (broadleaf-tolerant PRE)', () => {
    expect(checkCropCompatibility([pendi], tomato)).toEqual([]);
    expect(checkCropCompatibility([pendi], cabbage)).toEqual([]);
  });

  it('blocks paraquat over every standing crop (non-selective burndown)', () => {
    for (const c of [
      tomato,
      cabbage,
      onion,
      lettuce,
      carrot,
      celery,
      blueberry,
      peach,
      wheat,
      basil
    ]) {
      expect(checkCropCompatibility([paraquat], c)).toHaveLength(1);
    }
  });

  it('blocks Liberty/glufosinate over non-trait crops', () => {
    expect(checkCropCompatibility([liberty], tomato)).toHaveLength(1);
    expect(checkCropCompatibility([liberty], onion)).toHaveLength(1);
  });

  it('blocks Reflex/fomesafen over solanaceae + brassica', () => {
    expect(checkCropCompatibility([reflex], tomato)).toHaveLength(1);
    expect(checkCropCompatibility([reflex], cabbage)).toHaveLength(1);
    // small-fruit is NOT in PPO kill list because Valor (flumioxazin) is labeled
    // for established blueberry rows. Reflex specifically is not blueberry-safe
    // but the class-level matrix can't distinguish — handled via labelClaims.
  });

  it('blocks Pursuit/imazethapyr over alliums + leafy + cereal (long residual)', () => {
    expect(checkCropCompatibility([pursuit], onion)).toHaveLength(1);
    expect(checkCropCompatibility([pursuit], lettuce)).toHaveLength(1);
    expect(checkCropCompatibility([pursuit], wheat)).toHaveLength(1);
  });

  it('passes Command/clomazone over solanaceae but blocks brassica + leafy', () => {
    expect(checkCropCompatibility([command], tomato)).toEqual([]);
    expect(checkCropCompatibility([command], cabbage)).toHaveLength(1);
    expect(checkCropCompatibility([command], lettuce)).toHaveLength(1);
  });

  it('reports raspberry / peach / blueberry families correctly in violation detail', () => {
    expect(crops(checkCropCompatibility([atrazine], raspberry)[0])[0].cropFamily).toBe('bramble');
    expect(crops(checkCropCompatibility([atrazine], peach)[0])[0].cropFamily).toBe('stone-fruit');
    expect(crops(checkCropCompatibility([atrazine], blueberry)[0])[0].cropFamily).toBe(
      'small-fruit'
    );
  });
});
