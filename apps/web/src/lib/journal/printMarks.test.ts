import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { markGeometry, markShape, printMarkLines } from './printMarks';
import { PHOTO_MARK_KINDS, type PhotoMark, type PhotoMarkKind } from './model';

const WORD: Record<PhotoMarkKind, string> = {
  cut: 'Cut',
  pinch: 'Pinch',
  harvest: 'Harvest',
  leave: 'Leave',
  problem: 'Problem'
};

const mark = fc.record(
  {
    kind: fc.constantFrom(...PHOTO_MARK_KINDS),
    x: fc.double({ min: 0, max: 1, noNaN: true }),
    y: fc.double({ min: 0, max: 1, noNaN: true }),
    w: fc.double({ min: 0.01, max: 1, noNaN: true }),
    h: fc.double({ min: 0.01, max: 1, noNaN: true }),
    label: fc.oneof(
      fc.string(),
      fc.constantFrom('', '   ', '\t\n', 'Cut here', '  Yellow   lower leaves ')
    )
  },
  { requiredKeys: ['kind', 'x', 'y', 'label'] }
) as fc.Arbitrary<PhotoMark>;

describe('printMarkLines (#869, FU869-2)', () => {
  it('numbers the lines from 1 and never prints a blank label', () => {
    fc.assert(
      fc.property(fc.array(mark, { maxLength: 12 }), (marks) => {
        const lines = printMarkLines(marks, (k) => WORD[k]);
        expect(lines.map((l) => l.n)).toEqual(marks.map((_, i) => i + 1));
        for (const [i, l] of lines.entries()) {
          expect(l.label.trim().length).toBeGreaterThan(0);
          expect(l.kind).toBe(marks[i].kind);
          if (!marks[i].label.trim()) expect(l.label).toBe(WORD[marks[i].kind]);
        }
      })
    );
  });

  it('squeezes the spaces in a label and keeps its words', () => {
    expect(
      printMarkLines(
        [{ kind: 'problem', x: 0, y: 0, label: '  Yellow   lower leaves ' }],
        (k) => WORD[k]
      )
    ).toEqual([{ n: 1, kind: 'problem', label: 'Yellow lower leaves' }]);
  });

  it('falls back to the number when even the kind word is blank', () => {
    expect(printMarkLines([{ kind: 'cut', x: 0, y: 0, label: ' ' }], () => ' ')[0].label).toBe('1');
  });
});

describe('markGeometry', () => {
  it('draws problem marks as diamonds and every other kind as a circle', () => {
    for (const kind of PHOTO_MARK_KINDS) {
      expect(markShape(kind)).toBe(kind === 'problem' ? 'diamond' : 'circle');
    }
  });

  it('keeps every number badge inside the photo', () => {
    fc.assert(
      fc.property(
        fc.array(mark, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 40, max: 4000 }),
        fc.integer({ min: 40, max: 4000 }),
        (marks, width, height) => {
          for (const g of markGeometry(marks, width, height)) {
            expect(g.cx - g.r).toBeGreaterThanOrEqual(-1e-9);
            expect(g.cy - g.r).toBeGreaterThanOrEqual(-1e-9);
            expect(g.cx + g.r).toBeLessThanOrEqual(width + 1e-9);
            expect(g.cy + g.r).toBeLessThanOrEqual(height + 1e-9);
          }
        }
      )
    );
  });

  it('puts a point mark at its spot and a box at its centre, in photo pixels', () => {
    const [point, box] = markGeometry(
      [
        { kind: 'cut', x: 0.5, y: 0.25, label: 'Cut' },
        { kind: 'problem', x: 0.1, y: 0.5, w: 0.2, h: 0.4, label: 'Spots' }
      ],
      1000,
      800
    );
    expect([point.cx, point.cy, point.box]).toEqual([500, 200, null]);
    expect([box.cx, box.cy, box.shape]).toEqual([200, 560, 'diamond']);
    expect(box.box).toEqual({ x: 100, y: 400, w: 200, h: 320 });
  });
});
