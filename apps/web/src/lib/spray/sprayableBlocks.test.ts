import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { splitSprayable, sprayableAcres } from './sprayableBlocks';

const northA = { id: 'north-a', acres: 5 };
const wheatA = { id: 'wheat-a', acres: 15 };

describe('splitSprayable (#735)', () => {
  it('keeps every selected block before the kernel has judged', () => {
    expect(splitSprayable([northA, wheatA], new Map())).toEqual({
      sprayable: [northA, wheatA],
      stopped: []
    });
  });

  it('drops a stopped block from the pass, so the total is 5 ac, not 20', () => {
    const out = splitSprayable(
      [northA, wheatA],
      new Map([
        ['north-a', { ok: true }],
        ['wheat-a', { ok: false }]
      ])
    );
    expect(out.sprayable).toEqual([northA]);
    expect(out.stopped).toEqual([wheatA]);
    expect(sprayableAcres(out.sprayable)).toBe(5);
  });

  it('treats a block with no verdict as not sprayed', () => {
    const out = splitSprayable([northA, wheatA], new Map([['north-a', { ok: true }]]));
    expect(out.stopped).toEqual([wheatA]);
  });

  it('a stopped block never adds to the total (property)', () => {
    const block = fc.record({
      id: fc.uuid(),
      acres: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: null }),
      ok: fc.boolean()
    });
    fc.assert(
      fc.property(fc.uniqueArray(block, { selector: (b) => b.id, minLength: 1 }), (blocks) => {
        const verdicts = new Map(blocks.map((b) => [b.id, { ok: b.ok }]));
        const { sprayable, stopped } = splitSprayable(blocks, verdicts);
        expect(sprayable.every((b) => b.ok)).toBe(true);
        expect(stopped.every((b) => !b.ok)).toBe(true);
        expect(sprayable.length + stopped.length).toBe(blocks.length);
        const okAcres = blocks
          .filter((b) => b.ok)
          .reduce((s, b) => s + (b.acres != null && b.acres > 0 ? b.acres : 0), 0);
        expect(sprayableAcres(sprayable)).toBeCloseTo(okAcres, 6);
      })
    );
  });
});
