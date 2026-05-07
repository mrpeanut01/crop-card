import { describe, expect, it } from 'vitest';
import { checkTankMix } from './tankMix';
import type { HerbicideProduct } from './types';

const stadia: HerbicideProduct = {
  pluginId: 'stadia',
  displayName: 'Stadia',
  activeIngredients: [{ name: 'rimsulfuron', chemistryClass: 'sulfonylurea' }]
};
const clethodim: HerbicideProduct = {
  pluginId: 'clethodim',
  displayName: 'Clethodim',
  activeIngredients: [{ name: 'clethodim', chemistryClass: 'accase-inhibitor' }]
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe('checkTankMix', () => {
  it('blocks stadia + clethodim in the same tank', () => {
    const v = checkTankMix([stadia, clethodim], 0, []);
    expect(v.map((x) => x.code)).toContain('TANK_MIX_PROHIBITED');
  });

  it('blocks clethodim within 7 days of stadia', () => {
    const now = 7 * DAY_MS - 1;
    const v = checkTankMix([clethodim], now, [{ pluginId: 'stadia', occurredAt: 0 }]);
    expect(v.map((x) => x.code)).toContain('TANK_MIX_SEPARATION');
  });

  it('allows clethodim exactly 7 days after stadia', () => {
    const v = checkTankMix(
      [clethodim],
      7 * DAY_MS,
      [{ pluginId: 'stadia', occurredAt: 0 }]
    );
    expect(v).toEqual([]);
  });

  it('emits no separation violation when no prior history', () => {
    expect(checkTankMix([clethodim], 0, [])).toEqual([]);
  });

  it('symmetric: stadia within 7 days of clethodim also blocks', () => {
    const v = checkTankMix(
      [stadia],
      DAY_MS,
      [{ pluginId: 'clethodim', occurredAt: 0 }]
    );
    expect(v.map((x) => x.code)).toContain('TANK_MIX_SEPARATION');
  });
});
