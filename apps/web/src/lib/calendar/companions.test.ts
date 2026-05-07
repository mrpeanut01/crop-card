import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { suggestCompanions } from './companions';

const corn: CropPlugin = {
  pluginId: 'corn-bb',
  type: 'crop',
  displayName: 'Bloody Butcher',
  version: '1.0.0',
  cropFamily: 'corn'
};

const beans: CropPlugin = {
  pluginId: 'beans-r',
  type: 'crop',
  displayName: 'Rattlesnake Beans',
  version: '1.0.0',
  cropFamily: 'legume'
};

const pumpkin: CropPlugin = {
  pluginId: 'pumpkin-ezg',
  type: 'crop',
  displayName: 'EZ Gro',
  version: '1.0.0',
  cropFamily: 'cucurbit'
};

describe('suggestCompanions', () => {
  it('returns Three Sisters when corn is primary and both companions exist', () => {
    const out = suggestCompanions('corn', [corn, beans, pumpkin]);
    expect(out).toHaveLength(1);
    expect(out[0].systemName).toBe('Three Sisters');
    expect(out[0].members).toHaveLength(2);
    expect(out[0].members[0].cropPluginId).toBe('beans-r');
    expect(out[0].members[1].cropPluginId).toBe('pumpkin-ezg');
    expect(out[0].members[0].plantingOffsetDays).toBe(14);
    expect(out[0].members[1].plantingOffsetDays).toBe(35);
  });

  it('returns no suggestions when a required companion family is missing', () => {
    const out = suggestCompanions('corn', [corn, beans]);
    expect(out).toEqual([]);
  });

  it('returns no suggestions for non-corn primary', () => {
    expect(suggestCompanions('cucurbit', [corn, beans, pumpkin])).toEqual([]);
    expect(suggestCompanions('orchard', [corn, beans, pumpkin])).toEqual([]);
  });
});
