import { describe, expect, it } from 'vitest';
import { demoPantryFixture } from './pantryFixture';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import { dispositionCreateSchema } from '$lib/harvest/apiSchemas';
import { parseHarvestQuantity } from '$lib/finance/harvestSale';

describe('demoPantryFixture', () => {
  it('is herb harvests in the past whose dispositions pass the API schema and fit the harvest', () => {
    const rows = demoPantryFixture();
    expect(rows.length).toBeGreaterThan(0);
    for (const h of rows) {
      expect(isHerbGardenCrop(h.cropPluginId)).toBe(true);
      expect(h.daysAgo).toBeGreaterThan(0);
      const harvest = parseHarvestQuantity(h.quantity);
      let sum = 0;
      for (const d of h.dispositions) {
        expect(dispositionCreateSchema.safeParse(d).success).toBe(true);
        expect(d.unit).toBe(harvest?.unit);
        sum += d.quantity;
      }
      expect(sum).toBeLessThanOrEqual(harvest!.quantity);
    }
    expect(rows.some((h) => h.dispositions.some((d) => d.preservedAs === 'dry'))).toBe(true);
  });
});
