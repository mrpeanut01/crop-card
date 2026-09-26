import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FALLBACK_SPACING_IN, footprintForCount, plantCount, resolveSpacing } from './plantCount';
import type { GardenCrop, PlantSpacing, SpacingPattern } from './types';

const tomato: GardenCrop = {
  pluginId: 'tomato-celebrity-f1',
  displayName: 'Tomato Celebrity F1',
  cropFamily: 'solanaceae',
  archetype: 'continuous-harvest-fruit',
  daysToMaturity: { min: 70, max: 75 },
  defaultRowSpacingInches: 48,
  plantingGuide: { rowSpacingIn: 48, inRowSpacingIn: { min: 24, max: 36 } }
};

const buttercrunch: GardenCrop = {
  pluginId: 'lettuce-buttercrunch',
  displayName: 'Lettuce Buttercrunch',
  cropFamily: 'leafy-green',
  archetype: 'cut-and-come-again-leafy',
  daysToMaturity: { min: 50, max: 60 },
  defaultRowSpacingInches: 12
};

const salanova: GardenCrop = {
  pluginId: 'lettuce-salanova-mix',
  displayName: 'Salanova Mix',
  cropFamily: 'leafy-green',
  daysToMaturity: { min: 55, max: 60 },
  defaultRowSpacingInches: 12,
  plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 8, max: 10 } }
};

const patterns: SpacingPattern[] = ['square', 'offset', 'sfg'];

function spacing(
  inRowIn: number,
  rowIn = inRowIn,
  pattern: SpacingPattern = 'square'
): PlantSpacing {
  return { inRowIn, rowIn, pattern, source: 'plugin' };
}

describe('resolveSpacing', () => {
  it('uses the planting guide midpoint and row spacing', () => {
    expect(resolveSpacing(tomato, 'square')).toEqual({
      inRowIn: 30,
      rowIn: 48,
      pattern: 'square',
      source: 'plugin'
    });
  });

  it('uses the in-row value between rows when the guide has no row spacing', () => {
    const crop = { ...tomato, plantingGuide: { inRowSpacingIn: { min: 18, max: 18 } } };
    expect(resolveSpacing(crop, 'offset')).toMatchObject({
      inRowIn: 18,
      rowIn: 18,
      source: 'plugin'
    });
  });

  it('falls back to defaultRowSpacingInches both ways', () => {
    expect(resolveSpacing(buttercrunch, 'square')).toEqual({
      inRowIn: 12,
      rowIn: 12,
      pattern: 'square',
      source: 'fallback'
    });
  });

  it('falls back to 12 in with nothing on the plugin or no plugin', () => {
    const bare: GardenCrop = { pluginId: 'x', displayName: 'X', cropFamily: 'root' };
    for (const crop of [bare, undefined]) {
      expect(resolveSpacing(crop, 'sfg')).toMatchObject({
        inRowIn: FALLBACK_SPACING_IN,
        rowIn: FALLBACK_SPACING_IN,
        source: 'fallback'
      });
    }
  });

  it('ignores a zero-width guide range', () => {
    const crop = { ...buttercrunch, plantingGuide: { inRowSpacingIn: { min: 0, max: 0 } } };
    expect(resolveSpacing(crop, 'square').source).toBe('fallback');
  });

  it('lets a typed value win for whichever values it carries', () => {
    expect(resolveSpacing(tomato, 'square', { inRowIn: 24 })).toMatchObject({
      inRowIn: 24,
      rowIn: 48,
      source: 'manual'
    });
    expect(resolveSpacing(tomato, 'square', { inRowIn: null, rowIn: 36 })).toMatchObject({
      inRowIn: 30,
      rowIn: 36,
      source: 'manual'
    });
    expect(resolveSpacing(tomato, 'square', { inRowIn: null, rowIn: 0 }).source).toBe('plugin');
  });
});

describe('plantCount', () => {
  it('matches the household scenario: tomatoes in a 4 x 8 ft bed hold 3 plants', () => {
    const r = plantCount({ w_in: 48, l_in: 96 }, resolveSpacing(tomato, 'square'));
    expect(r).toEqual({ count: 3, rows: 1, perRow: 3, provenance: 'data' });
  });

  it('matches the household scenario: 4 x 4 ft of Buttercrunch holds 16 on fallback spacing', () => {
    const r = plantCount({ w_in: 48, l_in: 48 }, resolveSpacing(buttercrunch, 'square'));
    expect(r).toEqual({ count: 16, rows: 4, perRow: 4, provenance: 'fallback' });
  });

  it('matches the tunnel scenario: 3 x 15 ft of Salanova holds 60 in rows and 78 offset', () => {
    const fp = { w_in: 36, l_in: 180 };
    expect(plantCount(fp, resolveSpacing(salanova, 'square'))).toMatchObject({
      count: 60,
      provenance: 'data'
    });
    expect(plantCount(fp, resolveSpacing(salanova, 'offset'))).toMatchObject({
      count: 78,
      rows: 4,
      perRow: 20,
      provenance: 'data'
    });
  });

  it('counts square-foot cells', () => {
    expect(plantCount({ w_in: 48, l_in: 48 }, spacing(3, 3, 'sfg')).count).toBe(16 * 16);
    expect(plantCount({ w_in: 48, l_in: 48 }, spacing(6, 6, 'sfg')).count).toBe(16 * 4);
    expect(plantCount({ w_in: 48, l_in: 48 }, spacing(12, 12, 'sfg')).count).toBe(16);
    expect(plantCount({ w_in: 48, l_in: 96 }, spacing(18, 18, 'sfg')).count).toBe(2 * 4);
    expect(plantCount({ w_in: 48, l_in: 96 }, spacing(24, 24, 'sfg')).count).toBe(2 * 4);
    expect(plantCount({ w_in: 48, l_in: 96 }, spacing(30, 30, 'sfg')).count).toBe(1 * 2);
  });

  it('offset uses one row when the footprint is narrower than the spacing', () => {
    expect(plantCount({ w_in: 6, l_in: 36 }, spacing(12, 12, 'offset'))).toMatchObject({
      count: 3,
      rows: 1
    });
  });

  it('carries manual provenance for typed spacing', () => {
    expect(plantCount({ w_in: 12, l_in: 12 }, { ...spacing(6), source: 'manual' }).provenance).toBe(
      'manual'
    );
  });

  it('is always at least 1', () => {
    expect(plantCount({ w_in: 1, l_in: 1 }, spacing(48)).count).toBe(1);
    expect(plantCount({ w_in: 0, l_in: 0 }, spacing(12, 12, 'offset')).count).toBe(1);
    expect(plantCount({ w_in: 12, l_in: 12 }, spacing(0)).count).toBe(1);
  });

  it('is monotonic in footprint size for every pattern', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...patterns),
        fc.double({ min: 1, max: 60, noNaN: true }),
        fc.double({ min: 1, max: 60, noNaN: true }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (pattern, inRow, row, w, l, dw, dl) => {
          const s = spacing(inRow, row, pattern);
          const small = plantCount({ w_in: w, l_in: l }, s).count;
          const big = plantCount({ w_in: w + dw, l_in: l + dl }, s).count;
          expect(big).toBeGreaterThanOrEqual(small);
          expect(small).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(small)).toBe(true);
        }
      )
    );
  });

  it('never packs more plants than the footprint area allows', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...patterns),
        fc.integer({ min: 2, max: 48 }),
        fc.integer({ min: 12, max: 400 }),
        fc.integer({ min: 12, max: 400 }),
        (pattern, s, w, l) => {
          const r = plantCount({ w_in: w, l_in: l }, spacing(s, s, pattern));
          const perPlant = pattern === 'offset' ? (s * s * Math.sqrt(3)) / 2 : s * s;
          const bound = Math.max(1, ((w + s) * (l + s)) / perPlant);
          expect(r.count).toBeLessThanOrEqual(Math.ceil(bound));
        }
      )
    );
  });
});

describe('footprintForCount', () => {
  it('finds the shortest bed-wide footprint that holds the plants', () => {
    const s = resolveSpacing(salanova, 'square');
    expect(footprintForCount(60, s, 36)).toEqual({ w_in: 36, l_in: 180 });
    expect(footprintForCount(3, resolveSpacing(tomato, 'square'), 48)).toEqual({
      w_in: 48,
      l_in: 90
    });
  });

  it('uses 12 in steps for square foot', () => {
    expect(footprintForCount(16, spacing(12, 12, 'sfg'), 54)).toEqual({ w_in: 48, l_in: 48 });
  });

  it('holds at least the plants asked for, and one step less does not', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...patterns),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 2, max: 40 }),
        fc.integer({ min: 12, max: 120 }),
        (pattern, plants, s, bedW) => {
          const sp = spacing(s, s, pattern);
          const fp = footprintForCount(plants, sp, bedW);
          const step = pattern === 'sfg' ? 12 : 6;
          expect(fp.w_in).toBeLessThanOrEqual(Math.max(step, bedW));
          expect(plantCount(fp, sp).count).toBeGreaterThanOrEqual(plants);
          if (fp.l_in > step) {
            expect(plantCount({ ...fp, l_in: fp.l_in - step }, sp).count).toBeLessThan(plants);
          }
        }
      )
    );
  });
});
