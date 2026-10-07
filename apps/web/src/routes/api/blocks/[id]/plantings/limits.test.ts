import { describe, expect, it } from 'vitest';
import { MAX_PLAN_PLANTS } from '$lib/plan/allocationApi';
import { _requestSchema as plantingSchema } from './+server';

describe('POST /api/blocks/:id/plantings size (#722)', () => {
  it('accepts a field-scale planting on commit', () => {
    expect(plantingSchema.safeParse({ cropPluginId: 'corn', plannedPlants: 320_000 }).success).toBe(
      true
    );
    expect(
      plantingSchema.safeParse({ cropPluginId: 'corn', plannedPlants: MAX_PLAN_PLANTS + 1 }).success
    ).toBe(false);
  });
});
