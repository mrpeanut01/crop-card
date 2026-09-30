import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accumulate, dailyDegreeDays, isYmd, nextYmd, type DailyTemps } from './degreeDays';

/** Midpoint-rule integral of the clipped sine over one day, in degree days. */
function numericSine(tmax: number, tmin: number, base: number, upper?: number): number {
  const mean = (tmax + tmin) / 2;
  const amp = (tmax - tmin) / 2;
  const n = 20_000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = -Math.PI + ((i + 0.5) * 2 * Math.PI) / n;
    let temp = mean + amp * Math.sin(t);
    if (upper !== undefined) temp = Math.min(temp, upper);
    sum += Math.max(0, temp - base);
  }
  return sum / n;
}

const temp = fc.double({ min: -20, max: 115, noNaN: true });

describe('dailyDegreeDays', () => {
  it('simple average caps the maximum and never raises the minimum', () => {
    expect(dailyDegreeDays(80, 60, 'simple-average', 50)).toBe(20);
    expect(dailyDegreeDays(96, 60, 'simple-average', 50, 86)).toBe(23);
    expect(dailyDegreeDays(60, 30, 'simple-average', 50)).toBe(0);
    expect(dailyDegreeDays(70, 40, 'simple-average', 50)).toBe(5);
  });

  it('single sine handles every case against the base and cutoff', () => {
    expect(dailyDegreeDays(80, 60, 'single-sine', 50)).toBe(20);
    expect(dailyDegreeDays(45, 30, 'single-sine', 50)).toBe(0);
    expect(dailyDegreeDays(95, 92, 'single-sine', 50, 90)).toBe(40);
    for (const [hi, lo, up] of [
      [70, 40, undefined],
      [95, 60, 86],
      [95, 40, 86],
      [51, 49, undefined]
    ] as const) {
      expect(dailyDegreeDays(hi, lo, 'single-sine', 50, up)).toBeCloseTo(
        numericSine(hi, lo, 50, up),
        3
      );
    }
  });

  it('single sine matches a numeric integral of the clipped sine', () => {
    fc.assert(
      fc.property(
        temp,
        temp,
        fc.option(fc.double({ min: 1, max: 50, noNaN: true })),
        (a, b, gap) => {
          const base = 50;
          const upper = gap === null ? undefined : base + gap;
          const got = dailyDegreeDays(Math.max(a, b), Math.min(a, b), 'single-sine', base, upper);
          const want = numericSine(Math.max(a, b), Math.min(a, b), base, upper);
          expect(Math.abs(got - want)).toBeLessThan(0.01);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('is never negative for either method', () => {
    fc.assert(
      fc.property(
        temp,
        temp,
        fc.constantFrom('simple-average' as const, 'single-sine' as const),
        fc.double({ min: 0, max: 80, noNaN: true }),
        fc.option(fc.double({ min: 1, max: 60, noNaN: true })),
        (a, b, method, base, gap) => {
          const dd = dailyDegreeDays(a, b, method, base, gap === null ? undefined : base + gap);
          expect(dd).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  it('the two methods agree when the minimum is at or above the base and there is no cutoff', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 80, noNaN: true }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (base, above, spread) => {
          const tmin = base + above;
          const tmax = tmin + spread;
          expect(dailyDegreeDays(tmax, tmin, 'single-sine', base)).toBeCloseTo(
            dailyDegreeDays(tmax, tmin, 'simple-average', base),
            9
          );
        }
      )
    );
  });

  it('refuses non-finite temperatures and a cutoff at or below the base', () => {
    expect(() => dailyDegreeDays(NaN, 50, 'simple-average', 50)).toThrow(RangeError);
    expect(() => dailyDegreeDays(80, 60, 'single-sine', 50, 50)).toThrow(RangeError);
  });
});

function series(start: string, temps: Array<[number, number] | null>): DailyTemps[] {
  const out: DailyTemps[] = [];
  let ymd = start;
  for (const t of temps) {
    out.push({ ymd, tmaxF: t ? t[0] : null, tminF: t ? t[1] : null });
    ymd = nextYmd(ymd);
  }
  return out;
}

describe('accumulate', () => {
  const opts = { method: 'simple-average' as const, baseF: 50, toYmd: '2026-12-31' };

  it('counts from the biofix day inclusive', () => {
    const days = series('2026-05-01', [
      [80, 60],
      [70, 50],
      [90, 70]
    ]);
    expect(accumulate(days, '2026-05-02', opts)).toEqual({
      totalLowerBound: 40,
      missingDays: 0,
      throughYmd: '2026-05-03'
    });
  });

  it('never fills a gap and counts it as missing', () => {
    const days = series('2026-05-01', [[80, 60], null, [80, 60]]);
    expect(accumulate(days, '2026-05-01', opts)).toEqual({
      totalLowerBound: 40,
      missingDays: 1,
      throughYmd: '2026-05-03'
    });
    const absent = [days[0], days[2]];
    expect(accumulate(absent, '2026-05-01', opts).missingDays).toBe(1);
  });

  it('treats a day with only one extreme as missing', () => {
    const days: DailyTemps[] = [
      { ymd: '2026-05-01', tmaxF: 80, tminF: null },
      { ymd: '2026-05-02', tmaxF: 80, tminF: 60 }
    ];
    expect(accumulate(days, '2026-05-01', opts)).toMatchObject({
      totalLowerBound: 20,
      missingDays: 1
    });
  });

  it('does not count unpublished days after the last row as missing', () => {
    const days = series('2026-05-01', [[80, 60]]);
    expect(accumulate(days, '2026-05-01', { ...opts, toYmd: '2026-05-04' })).toEqual({
      totalLowerBound: 20,
      missingDays: 0,
      throughYmd: '2026-05-01'
    });
  });

  it('ignores rows after the last day to count, and returns nothing before any data', () => {
    const days = series('2026-05-01', [
      [80, 60],
      [80, 60]
    ]);
    expect(accumulate(days, '2026-05-01', { ...opts, toYmd: '2026-05-01' }).totalLowerBound).toBe(
      20
    );
    expect(accumulate([], '2026-05-01', opts)).toEqual({
      totalLowerBound: 0,
      missingDays: 0,
      throughYmd: null
    });
    expect(accumulate(days, '2026-06-01', { ...opts, toYmd: '2026-05-31' }).throughYmd).toBeNull();
  });

  it('is monotonic: adding a later day never lowers the total', () => {
    const day = fc.option(fc.tuple(temp, temp), { freq: 5 });
    fc.assert(
      fc.property(
        fc.array(day, { minLength: 1, maxLength: 60 }),
        fc.constantFrom('simple-average' as const, 'single-sine' as const),
        fc.option(fc.double({ min: 10, max: 50, noNaN: true })),
        (temps, method, gap) => {
          const days = series('2026-03-01', temps);
          const o = { method, baseF: 50, upperCutoffF: gap === null ? undefined : 50 + gap };
          let prev = 0;
          let ymd = '2026-03-01';
          for (let i = 0; i < days.length; i++) {
            const acc = accumulate(days, '2026-03-01', { ...o, toYmd: ymd });
            expect(acc.totalLowerBound).toBeGreaterThanOrEqual(prev - 1e-9);
            expect(acc.totalLowerBound).toBeGreaterThanOrEqual(0);
            expect(acc.missingDays).toBeGreaterThanOrEqual(0);
            prev = acc.totalLowerBound;
            ymd = nextYmd(ymd);
          }
        }
      )
    );
  });

  it('a gap-free total is never below the same series with gaps punched in', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(temp, temp), { minLength: 1, maxLength: 40 }),
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        (temps, holes) => {
          const full = series('2026-04-01', temps);
          const holed = full.map((d, i) => (holes[i] ? { ...d, tmaxF: null } : d));
          const o = { ...opts, method: 'single-sine' as const };
          expect(accumulate(holed, '2026-04-01', o).totalLowerBound).toBeLessThanOrEqual(
            accumulate(full, '2026-04-01', o).totalLowerBound + 1e-9
          );
        }
      )
    );
  });

  it('validates calendar days', () => {
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(nextYmd('2026-12-31')).toBe('2027-01-01');
  });
});
