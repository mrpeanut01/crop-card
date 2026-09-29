import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  checkBedProposal,
  deterministicBedLayout,
  lengthNeededFt,
  planBeds,
  rowsAcross,
  type BedLayoutCrop
} from './bedLayout';

const TOMATO: BedLayoutCrop = {
  key: 't',
  name: 'Tomato',
  family: 'solanaceae',
  plants: 12,
  inRowIn: 24,
  rowIn: 36
};
const LETTUCE: BedLayoutCrop = {
  key: 'l',
  name: 'Lettuce',
  family: 'leafy-green',
  plants: 60,
  inRowIn: 10,
  rowIn: 12
};
const SQUASH: BedLayoutCrop = {
  key: 's',
  name: 'Squash',
  family: 'cucurbit',
  plants: 4,
  inRowIn: 36,
  rowIn: 72
};

const OPTS20 = { bedWidthFt: 4, maxBedLengthFt: 20 };
const WIDE = { bedWidthFt: 4, maxBedLengthFt: 300 };

describe('bed layout (#475)', () => {
  it('fits rows across the bed and sizes the length from spacing', () => {
    expect(rowsAcross(4, 12)).toBe(4);
    expect(rowsAcross(4, 36)).toBe(1);
    expect(lengthNeededFt(LETTUCE, 60, 4)).toBe(13);
    expect(lengthNeededFt(TOMATO, 12, 4)).toBe(24);
  });

  it('places every plant, starts a new bed at the longest bed, and widens a bed for a wide row', () => {
    const beds = deterministicBedLayout([TOMATO, LETTUCE, SQUASH], {
      bedWidthFt: 4,
      maxBedLengthFt: 20
    });
    const placed = new Map<string, number>();
    for (const b of beds) {
      expect(b.lengthFt).toBeLessThanOrEqual(20);
      for (const c of b.crops) placed.set(c.key, (placed.get(c.key) ?? 0) + c.plants);
    }
    expect(Object.fromEntries(placed)).toEqual({ t: 12, l: 60, s: 4 });
    expect(beds.find((b) => b.crops.some((c) => c.key === 's'))!.widthFt).toBe(6);
    expect(checkBedProposal(beds, [TOMATO, LETTUCE, SQUASH], OPTS20).ok).toBe(true);
  });

  it('refuses a proposal that leaves plants out, crams a bed, or names another seed', () => {
    const crops = [TOMATO, LETTUCE];
    expect(
      checkBedProposal(
        [{ widthFt: 4, lengthFt: 40, crops: [{ key: 't', plants: 12 }] }],
        crops,
        WIDE
      )
    ).toMatchObject({ ok: false });
    expect(
      checkBedProposal(
        [
          {
            widthFt: 4,
            lengthFt: 10,
            crops: [
              { key: 't', plants: 12 },
              { key: 'l', plants: 60 }
            ]
          }
        ],
        crops,
        WIDE
      )
    ).toMatchObject({ ok: false, reason: 'crops do not fit the bed' });
    expect(
      checkBedProposal(
        [{ widthFt: 4, lengthFt: 99, crops: [{ key: 'other-farm-seed', plants: 1 }] }],
        crops,
        WIDE
      )
    ).toMatchObject({ ok: false });
    expect(
      checkBedProposal([{ widthFt: 2, lengthFt: 99, crops: [{ key: 's', plants: 4 }] }], [SQUASH], {
        bedWidthFt: 2,
        maxBedLengthFt: 300
      })
    ).toMatchObject({ ok: false, reason: 'row wider than bed' });
  });

  it('rewrites rows and lengths from spacing instead of trusting the proposal', () => {
    const r = checkBedProposal(
      [{ widthFt: 4, lengthFt: 30, crops: [{ key: 'l', plants: 60 }] }],
      [LETTUCE],
      { bedWidthFt: 4, maxBedLengthFt: 30 }
    );
    expect(r).toEqual({
      ok: true,
      beds: [
        {
          widthFt: 4,
          lengthFt: 30,
          crops: [{ key: 'l', name: 'Lettuce', plants: 60, rows: 4, lengthFt: 13 }]
        }
      ]
    });
  });

  it('refuses a bed longer or wider than the owner asked for (r6 regression)', () => {
    const tomato = { ...TOMATO, plants: 40, inRowIn: 24, rowIn: 48 };
    const opts = { bedWidthFt: 4, maxBedLengthFt: 25 };
    expect(
      checkBedProposal(
        [{ widthFt: 4, lengthFt: 80, crops: [{ key: 't', plants: 40 }] }],
        [tomato],
        opts
      )
    ).toMatchObject({ ok: false, reason: 'bed longer than the longest bed' });
    expect(
      checkBedProposal(
        [{ widthFt: 12, lengthFt: 25, crops: [{ key: 't', plants: 40 }] }],
        [tomato],
        opts
      )
    ).toMatchObject({ ok: false, reason: 'bed wider than asked' });
    const squash = { ...SQUASH, plants: 1, inRowIn: 48, rowIn: 96 };
    expect(
      checkBedProposal([{ widthFt: 8, lengthFt: 4, crops: [{ key: 's', plants: 1 }] }], [squash], {
        bedWidthFt: 4,
        maxBedLengthFt: 3
      }).ok
    ).toBe(true);
  });

  it('never runs a plain bed past the longest bed when a second crop cannot fit (r6 regression)', () => {
    const squash = { ...SQUASH, plants: 3, inRowIn: 48, rowIn: 96 };
    const other = { key: 'a', name: 'A', family: 'cucurbit', plants: 1, inRowIn: 48, rowIn: 96 };
    const beds = deterministicBedLayout([squash, other], { bedWidthFt: 4, maxBedLengthFt: 10 });
    for (const b of beds) expect(b.lengthFt).toBeLessThanOrEqual(10);
    expect(beds.flatMap((b) => b.crops).reduce((n, c) => n + c.plants, 0)).toBe(4);
  });

  it('reports the seed that does not fit in 20 beds instead of dropping it (r6 regression)', () => {
    const tomato = { ...TOMATO, plants: 1000, inRowIn: 24, rowIn: 48 };
    const plan = planBeds([tomato], { bedWidthFt: 4, maxBedLengthFt: 25 });
    expect(plan.beds).toHaveLength(20);
    const placed = plan.beds.flatMap((b) => b.crops).reduce((n, c) => n + c.plants, 0);
    expect(plan.unplaced).toEqual([{ key: 't', name: 'Tomato', plants: 1000 - placed }]);
    expect(1000 - placed).toBeGreaterThan(0);
  });

  it('always yields a plan the checker accepts (property)', () => {
    const crop = fc.record({
      key: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 8 }),
      family: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null }),
      plants: fc.integer({ min: 1, max: 400 }),
      inRowIn: fc.integer({ min: 2, max: 48 }),
      rowIn: fc.integer({ min: 6, max: 96 })
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(crop, { selector: (c) => c.key, minLength: 1, maxLength: 5 }),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 8, max: 60 }),
        (crops, width, maxLen) => {
          const opts = { bedWidthFt: width, maxBedLengthFt: maxLen };
          const { beds, unplaced } = planBeds(crops, opts);
          const placed = new Map<string, number>();
          for (const b of beds)
            for (const c of b.crops) placed.set(c.key, (placed.get(c.key) ?? 0) + c.plants);
          for (const c of crops) {
            const left = unplaced.find((u) => u.key === c.key)?.plants ?? 0;
            expect((placed.get(c.key) ?? 0) + left).toBe(c.plants);
          }
          for (const b of beds) {
            const onePlant = Math.max(
              ...b.crops.map((s) =>
                lengthNeededFt(
                  crops.find((c) => c.key === s.key)!,
                  1,
                  b.widthFt
                )
              )
            );
            expect(b.lengthFt).toBeLessThanOrEqual(Math.max(maxLen, onePlant));
          }
          if (unplaced.length === 0) expect(checkBedProposal(beds, crops, opts).ok).toBe(true);
        }
      )
    );
  });
});
