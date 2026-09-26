import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { footprintSchema, parseFootprint, serializeFootprint } from './footprint';

describe('footprint', () => {
  it('round-trips a valid footprint', () => {
    fc.assert(
      fc.property(
        fc.record({
          x_in: fc.integer({ min: 0, max: 5000 }),
          y_in: fc.integer({ min: 0, max: 5000 }),
          w_in: fc.integer({ min: 1, max: 5000 }),
          l_in: fc.integer({ min: 1, max: 5000 })
        }),
        (fp) => {
          expect(parseFootprint(serializeFootprint(fp))).toEqual(fp);
        }
      )
    );
  });

  it('rejects negative offsets, zero sizes and extra keys', () => {
    expect(footprintSchema.safeParse({ x_in: -1, y_in: 0, w_in: 12, l_in: 12 }).success).toBe(
      false
    );
    expect(footprintSchema.safeParse({ x_in: 0, y_in: 0, w_in: 0, l_in: 12 }).success).toBe(false);
    expect(
      footprintSchema.safeParse({ x_in: 0, y_in: 0, w_in: 12, l_in: 12, lat: 39 }).success
    ).toBe(false);
  });

  it('reads unusable JSON as null', () => {
    expect(parseFootprint(null)).toBeNull();
    expect(parseFootprint('{')).toBeNull();
    expect(parseFootprint(JSON.stringify({ x_in: 0 }))).toBeNull();
    expect(serializeFootprint(null)).toBeNull();
  });
});
