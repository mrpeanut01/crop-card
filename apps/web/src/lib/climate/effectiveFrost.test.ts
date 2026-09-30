import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { effectiveFrostDates, effectiveFrostIso, effectiveFrostSummary } from './effectiveFrost';
import type { BlockProtection, ProtectionKind } from './protection';
import { frostDatesFromMmDd } from '$lib/schedule/frostSeason';

const DAY = 86_400_000;
const Y = 2027;
const farm = frostDatesFromMmDd(Y, '04-20', '10-15');

function cover(
  kind: ProtectionKind,
  spring: number | null,
  fall: number | null,
  extra: Partial<BlockProtection> = {}
): BlockProtection {
  return {
    id: `p-${kind}-${spring}-${fall}`,
    blockId: 'b1',
    kind,
    springShiftDays: spring,
    fallShiftDays: fall,
    provenance: 'manual',
    installedOn: null,
    removedOn: null,
    seasonYear: null,
    ...extra
  };
}

describe('effectiveFrostDates', () => {
  it('returns the farm dates unchanged with no covers', () => {
    const e = effectiveFrostDates(farm, { seasonYear: Y, protections: [] });
    expect(e.lastSpringFrostMs).toBe(farm.lastSpringFrostMs);
    expect(e.firstFallFrostMs).toBe(farm.firstFallFrostMs);
    expect(e.frostFree).toBe(false);
    expect(e.provenance).toBeNull();
    expect(e.springBy).toBeNull();
  });

  it('moves spring earlier and fall later', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('low-tunnel', 21, 14)]
    });
    expect(e.lastSpringFrostMs).toBe(farm.lastSpringFrostMs - 21 * DAY);
    expect(e.firstFallFrostMs).toBe(farm.firstFallFrostMs + 14 * DAY);
    expect(e.springShiftDays).toBe(21);
    expect(e.fallShiftDays).toBe(14);
    expect(e.springBy).toBe('low-tunnel');
    expect(e.provenance).toBe('manual');
  });

  it('takes the largest shift per side when covers stack, never the sum', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('row-cover', 10, 20), cover('low-tunnel', 21, 5)]
    });
    expect(e.springShiftDays).toBe(21);
    expect(e.springBy).toBe('low-tunnel');
    expect(e.fallShiftDays).toBe(20);
    expect(e.fallBy).toBe('row-cover');
  });

  it('keeps a heated greenhouse frost-free', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('greenhouse-heated', null, null)]
    });
    expect(e.frostFree).toBe(true);
    expect(e.lastSpringFrostMs).toBe(new Date(Y, 0, 1).getTime());
    expect(e.firstFallFrostMs).toBe(new Date(Y, 11, 31).getTime());
  });

  it('treats a heated greenhouse Area as frost-free', () => {
    expect(
      effectiveFrostDates(farm, { seasonYear: Y, protections: [], heatedArea: true }).frostFree
    ).toBe(true);
  });

  it('adds an implicit unheated greenhouse cover whose shift is not known', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [],
      unheatedGreenhouseArea: true
    });
    expect(e.frostFree).toBe(false);
    expect(e.unknownShift).toEqual(['greenhouse-unheated']);
    expect(e.lastSpringFrostMs).toBe(farm.lastSpringFrostMs);
  });

  it('reports covers with an unknown shift and never treats them as zero silently', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('row-cover', null, null)]
    });
    expect(e.unknownShift).toEqual(['row-cover']);
    expect(effectiveFrostSummary(e)).toBe('Covered, shift not known');
  });

  it('counts a spring-only cover only on the spring side', () => {
    const removed = farm.lastSpringFrostMs + 20 * DAY;
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('row-cover', 14, 14, { removedOn: removed })]
    });
    expect(e.springShiftDays).toBe(14);
    expect(e.fallShiftDays).toBe(0);
    expect(e.fallBy).toBeNull();
  });

  it('ignores a cover installed after the spring frost for spring, counts it for fall', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('row-cover', 14, 21, { installedOn: farm.lastSpringFrostMs + DAY })]
    });
    expect(e.springShiftDays).toBe(0);
    expect(e.fallShiftDays).toBe(21);
  });

  it('ignores a cover for another season year', () => {
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('row-cover', 14, 14, { seasonYear: Y - 1 })]
    });
    expect(e.springShiftDays).toBe(0);
  });

  it('never moves past a saved hard frost', () => {
    const hardLast = farm.lastSpringFrostMs - 10 * DAY;
    const hardFirst = farm.firstFallFrostMs + 7 * DAY;
    const e = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('high-tunnel', 30, 30)],
      hardFrost: { lastSpringFrostMs: hardLast, firstFallFrostMs: hardFirst }
    });
    expect(e.lastSpringFrostMs).toBe(hardLast);
    expect(e.firstFallFrostMs).toBe(hardFirst);
    expect(e.springShiftDays).toBe(10);
    expect(e.fallShiftDays).toBe(7);
  });

  it('works for a fall brassica under row cover across a year-crossing season', () => {
    const crossing = frostDatesFromMmDd(Y, '01-20', '12-20');
    const e = effectiveFrostDates(crossing, {
      seasonYear: Y,
      protections: [cover('row-cover', 0, 14)]
    });
    expect(e.firstFallFrostMs).toBe(crossing.firstFallFrostMs + 14 * DAY);
  });

  it('turns frost-free when the season would never freeze', () => {
    const warm = frostDatesFromMmDd(Y, '02-01', '12-01');
    const e = effectiveFrostDates(warm, {
      seasonYear: Y,
      protections: [cover('high-tunnel', 60, 60)]
    });
    expect(e.frostFree).toBe(true);
    expect(effectiveFrostSummary(e)).toBe('Covered: no frost limit with these cover shifts.');
  });

  it('names a heated greenhouse only when heat made the bed frost-free', () => {
    const heated = effectiveFrostDates(farm, {
      seasonYear: Y,
      protections: [cover('greenhouse-heated', null, null)]
    });
    expect(effectiveFrostSummary(heated)).toBe('Heated greenhouse: no frost limit.');
    const area = effectiveFrostDates(farm, { seasonYear: Y, protections: [], heatedArea: true });
    expect(effectiveFrostSummary(area)).toBe('Heated greenhouse: no frost limit.');
  });

  it('property: covers only warm a bed, and stacking equals the per-side max', () => {
    const arbCover = fc.record({
      spring: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
      fall: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null })
    });
    fc.assert(
      fc.property(fc.array(arbCover, { maxLength: 5 }), (cs) => {
        const ps = cs.map((c, i) => ({ ...cover('row-cover', c.spring, c.fall), id: `c${i}` }));
        const e = effectiveFrostDates(farm, { seasonYear: Y, protections: ps });
        if (e.frostFree) return;
        expect(e.lastSpringFrostMs).toBeLessThanOrEqual(farm.lastSpringFrostMs);
        expect(e.firstFallFrostMs).toBeGreaterThanOrEqual(farm.firstFallFrostMs);
        const maxS = Math.max(0, ...cs.map((c) => c.spring ?? 0));
        const maxF = Math.max(0, ...cs.map((c) => c.fall ?? 0));
        expect(e.springShiftDays).toBe(maxS);
        expect(e.fallShiftDays).toBe(maxF);
      })
    );
  });
});

describe('effectiveFrostIso', () => {
  it('shifts ISO days', () => {
    const r = effectiveFrostIso(
      { lastSpring: '2027-04-20', firstFall: '2027-10-15' },
      { seasonYear: Y, protections: [cover('low-tunnel', 21, 10)] }
    );
    expect(r).toEqual({ lastSpring: '2027-03-30', firstFall: '2027-10-25', frostFree: false });
  });

  it('returns Jan 1 to Dec 31 when frost-free', () => {
    const r = effectiveFrostIso(
      { lastSpring: '2027-04-20', firstFall: '2027-10-15' },
      { seasonYear: Y, protections: [], heatedArea: true }
    );
    expect(r).toEqual({ lastSpring: '2027-01-01', firstFall: '2027-12-31', frostFree: true });
  });
});
