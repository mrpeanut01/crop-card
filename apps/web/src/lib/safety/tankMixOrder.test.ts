import { describe, expect, it } from 'vitest';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { buildTankMixSteps } from './tankMixOrder';

const auxin: HerbicidePlugin = {
  pluginId: '24d',
  type: 'herbicide',
  displayName: '2,4-D Amine',
  version: '1.0.0',
  activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }],
  ratePerAcre: { amount: 1, unit: 'pt' },
  gpaCalibration: 15,
  tankMixOrder: 4,
  requiresAMS: true
};

const stadia: HerbicidePlugin = {
  pluginId: 'stadia',
  type: 'herbicide',
  displayName: 'Stadia',
  version: '1.0.0',
  activeIngredients: [{ name: 'stadia-ai', chemistryClass: 'sulfonylurea' }],
  ratePerAcre: { amount: 1.5, unit: 'oz' },
  gpaCalibration: 15,
  tankMixOrder: 2,
  requiresAMS: true
};

describe('buildTankMixSteps', () => {
  it('always starts with half-fill water and ends with spray-within-2-hours', () => {
    const steps = buildTankMixSteps([auxin]);
    expect(steps[0].instruction).toMatch(/half-fill/i);
    expect(steps[steps.length - 1].instruction).toMatch(/2 hours/i);
  });

  it('inserts AMS-first when any product requires AMS', () => {
    const steps = buildTankMixSteps([auxin]);
    const amsStep = steps.find((s) => /AMS/i.test(s.instruction));
    expect(amsStep).toBeDefined();
    expect(amsStep!.order).toBe(2);
  });

  it('orders products by tankMixOrder ascending', () => {
    const steps = buildTankMixSteps([auxin, stadia]);
    const productSteps = steps.filter((s) => s.productPluginId);
    expect(productSteps.map((s) => s.productPluginId)).toEqual(['stadia', '24d']);
  });

  it('skips AMS step when no product requires it', () => {
    const noAms: HerbicidePlugin = { ...auxin, requiresAMS: false };
    const steps = buildTankMixSteps([noAms]);
    expect(steps.some((s) => /AMS/i.test(s.instruction))).toBe(false);
  });
});
