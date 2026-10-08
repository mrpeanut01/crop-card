import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { visibleAreaLabels, type AreaLabelBox } from './areaLabelLayout';

const box = (id: string, shape: number, x: number, y: number, w = 60, h = 16): AreaLabelBox => ({
  id,
  shapeW: shape,
  shapeH: shape,
  x,
  y,
  w,
  h
});

describe('visibleAreaLabels', () => {
  it('hides a name that does not fit its Area at this zoom', () => {
    expect([...visibleAreaLabels([box('barn', 12, 0, 0)])]).toEqual([]);
    expect([...visibleAreaLabels([box('field', 300, 0, 0)])]).toEqual(['field']);
  });

  it('keeps the bigger Area name when two names would pile up', () => {
    const show = visibleAreaLabels([
      box('garden', 80, 10, 10),
      box('tunnel', 70, 20, 14),
      box('pasture', 400, 15, 12)
    ]);
    expect([...show]).toEqual(['pasture']);
  });

  it('shows names that sit apart', () => {
    const show = visibleAreaLabels([box('a', 200, 0, 0), box('b', 200, 0, 40)]);
    expect(show).toEqual(new Set(['a', 'b']));
  });

  it('leaves unmeasured labels alone', () => {
    expect([...visibleAreaLabels([box('x', 0, 0, 0, 0, 0), box('y', 0, 0, 0, 0, 0)])]).toEqual([
      'x',
      'y'
    ]);
  });

  it('never shows two overlapping names', () => {
    const arb = fc.array(
      fc.record({
        id: fc.uuid(),
        shapeW: fc.integer({ min: 0, max: 500 }),
        shapeH: fc.integer({ min: 0, max: 500 }),
        x: fc.integer({ min: 0, max: 400 }),
        y: fc.integer({ min: 0, max: 400 }),
        w: fc.integer({ min: 1, max: 120 }),
        h: fc.integer({ min: 1, max: 24 })
      }),
      { maxLength: 12 }
    );
    fc.assert(
      fc.property(arb, (boxes) => {
        const shown = boxes.filter((b) => visibleAreaLabels(boxes).has(b.id));
        for (let i = 0; i < shown.length; i++)
          for (let j = i + 1; j < shown.length; j++) {
            const a = shown[i];
            const b = shown[j];
            const overlap =
              a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            if (a.id !== b.id) expect(overlap).toBe(false);
          }
      })
    );
  });
});
