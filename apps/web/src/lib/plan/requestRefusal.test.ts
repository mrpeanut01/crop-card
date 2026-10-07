import { describe, expect, it } from 'vitest';
import { isRetryableStatus, planRefusalText } from './requestRefusal';
import { MAX_PLAN_PLANTS, seedSelectionSchema } from './allocationApi';
import { bedLayoutRequestSchema } from './bedLayoutApi';
import { planBeds, MAX_SUGGESTED_BEDS } from './bedLayout';

const tooBig = (path: Array<string | number>, maximum: number) => ({
  error: 'invalid request',
  issues: [{ code: 'too_big', maximum, path }]
});

describe('planRefusalText (#688 #722)', () => {
  it('names the seed and what to change for a too-big seed lot', () => {
    const text = planRefusalText(
      tooBig(['seedSelections', 2, 'quantityPlants'], 1_000_000),
      400,
      undefined,
      ['Wheat', 'Corn', 'Asgrow soybeans']
    );
    expect(text).toContain('Asgrow soybeans');
    expect(text).toContain('plant count');
    expect(text).toContain('1,000,000');
    expect(text).toContain('Seeds step');
    expect(text).not.toBe('invalid request');
  });

  it('reads in Spanish', () => {
    const text = planRefusalText(tooBig(['plannedPlants'], 100_000), 400, 'es');
    expect(text).toContain('número de plantas');
    expect(text).not.toContain('invalid request');
  });

  it('names the field when no seed is involved', () => {
    expect(planRefusalText(tooBig(['plannedPlants'], 100_000), 400, undefined)).toBe(
      'The plant count is more than one planting can hold (at most 100,000).'
    );
  });

  it("falls back to the server's message, then the status", () => {
    expect(planRefusalText({ error: 'Block not found' }, 404, undefined)).toBe('Block not found');
    expect(planRefusalText(null, 502, undefined)).toContain('502');
  });

  it('retries only what can succeed later', () => {
    for (const s of [400, 403, 404, 409, 413, 422]) expect(isRetryableStatus(s)).toBe(false);
    for (const s of [408, 429, 500, 502, 503]) expect(isRetryableStatus(s)).toBe(true);
  });
});

describe('field-scale plan sizes (#688 #722)', () => {
  const sel = { stockItemId: 's', cropPluginId: 'soy', varietyDisplayName: 'Soy' };

  it('accepts a field-scale seed lot on allocate, refine and beds/suggest', () => {
    expect(seedSelectionSchema.safeParse({ ...sel, quantityPlants: 1_020_000 }).success).toBe(true);
    expect(seedSelectionSchema.safeParse({ ...sel, quantityPlants: 140_000_000 }).success).toBe(
      true
    );
    expect(seedSelectionSchema.safeParse({ ...sel, areaSqFt: 43_560 * 1000 }).success).toBe(true);
    expect(
      bedLayoutRequestSchema.safeParse({
        seeds: [{ stockItemId: 's', plants: 1_020_000 }],
        bedWidthFt: 4,
        maxBedLengthFt: 25
      }).success
    ).toBe(true);
  });

  it('suggests beds for a huge count without building millions of beds', () => {
    const started = Date.now();
    const plan = planBeds(
      [{ key: 'k', name: 'Soy', family: null, plants: MAX_PLAN_PLANTS, inRowIn: 2, rowIn: 15 }],
      { bedWidthFt: 4, maxBedLengthFt: 25 }
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(plan.beds).toHaveLength(MAX_SUGGESTED_BEDS);
    expect(plan.unplaced[0].plants).toBe(
      MAX_PLAN_PLANTS - plan.beds.reduce((s, b) => s + b.crops[0].plants, 0)
    );
  });
});
