import { describe, expect, it } from 'vitest';
import { pluginShortensHold } from './holdFields';

const shared = {
  pluginId: 'p',
  preHarvestIntervalDays: 1,
  preHarvestIntervalsByCrop: [{ cropPluginId: 'corn', preHarvestIntervalDays: 21 }]
};

describe('pluginShortensHold — by-crop PHI (#661)', () => {
  it('refuses a farm copy that lowers a crop entry', () => {
    const farm = {
      ...shared,
      preHarvestIntervalsByCrop: [{ cropPluginId: 'corn', preHarvestIntervalDays: 7 }]
    };
    expect(pluginShortensHold(shared, farm).map((c) => c.field)).toContain(
      'preHarvestIntervalsByCrop[cropPluginId=corn].preHarvestIntervalDays'
    );
  });

  it('refuses a farm copy that adds a shorter entry for a crop the shared copy did not list', () => {
    const farm = {
      ...shared,
      preHarvestIntervalsByCrop: [
        ...shared.preHarvestIntervalsByCrop,
        { cropPluginId: 'wheat', preHarvestIntervalDays: 1 }
      ]
    };
    expect(pluginShortensHold(shared, farm)).toContainEqual({
      field: 'preHarvestIntervalsByCrop[wheat]',
      shared: '21',
      farm: '1'
    });
  });

  it('refuses a by-crop table added under a single PHI when it goes shorter', () => {
    const single = { pluginId: 'p', preHarvestIntervalDays: 14 };
    const farm = {
      ...single,
      preHarvestIntervalsByCrop: [{ cropFamily: 'grass-cereal', preHarvestIntervalDays: 7 }]
    };
    expect(pluginShortensHold(single, farm).map((c) => c.field)).toContain(
      'preHarvestIntervalsByCrop[grass-cereal]'
    );
  });

  it('allows a farm copy that only lengthens', () => {
    const farm = {
      ...shared,
      preHarvestIntervalsByCrop: [
        { cropPluginId: 'corn', preHarvestIntervalDays: 30 },
        { cropPluginId: 'wheat', preHarvestIntervalDays: 30 }
      ]
    };
    expect(pluginShortensHold(shared, farm)).toEqual([]);
  });
});
