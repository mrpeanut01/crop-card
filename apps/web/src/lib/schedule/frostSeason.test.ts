import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  frostDatesFromMmDd,
  frostSeasonShape,
  frostSeasonYears,
  monthDayOfYear
} from './frostSeason';

const md = (mmdd: string) => {
  const [m, d] = mmdd.split('-').map(Number);
  return { month: m - 1, day: d };
};
const local = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('frostSeasonShape', () => {
  it('keeps an ordinary season in one year', () => {
    expect(frostSeasonShape(md('04-15'), md('10-15'))).toBe('same-year');
    expect(frostSeasonYears(2027, md('04-15'), md('10-15'))).toEqual({
      lastSpringYear: 2027,
      firstFallYear: 2027
    });
  });

  it('moves an early-January first frost into the next year (Gulf coast)', () => {
    expect(frostSeasonShape(md('01-31'), md('01-06'))).toBe('fall-next-year');
    expect(frostSeasonYears(2027, md('01-31'), md('01-06'))).toEqual({
      lastSpringYear: 2027,
      firstFallYear: 2028
    });
  });

  it('moves a late-December last frost into the year before (desert)', () => {
    expect(frostSeasonShape(md('12-31'), md('12-27'))).toBe('spring-prior-year');
    expect(frostSeasonYears(2027, md('12-31'), md('12-27'))).toEqual({
      lastSpringYear: 2026,
      firstFallYear: 2027
    });
  });

  it('reads a cold mountain season with a July last frost as one year', () => {
    expect(frostSeasonShape(md('07-05'), md('08-20'))).toBe('same-year');
  });

  it('counts day of year on a non-leap calendar', () => {
    expect(monthDayOfYear(md('01-01'))).toBe(1);
    expect(monthDayOfYear(md('12-31'))).toBe(365);
    expect(monthDayOfYear(md('03-01'))).toBe(60);
  });
});

describe('frostDatesFromMmDd', () => {
  it('matches the old same-year result for Loudoun', () => {
    const f = frostDatesFromMmDd(2027, '04-15', '10-15');
    expect(local(f.lastSpringFrostMs)).toBe('2027-04-15');
    expect(local(f.firstFallFrostMs)).toBe('2027-10-15');
  });

  it('gives a Dauphin Island style station a season into next January', () => {
    const f = frostDatesFromMmDd(2027, '01-31', '01-06');
    expect(local(f.lastSpringFrostMs)).toBe('2027-01-31');
    expect(local(f.firstFallFrostMs)).toBe('2028-01-06');
    expect(Math.round((f.firstFallFrostMs - f.lastSpringFrostMs) / 86_400_000)).toBe(340);
  });

  it('falls back to Loudoun for a missing or unreadable date', () => {
    const f = frostDatesFromMmDd(2027, null, 'nope');
    expect(local(f.lastSpringFrostMs)).toBe('2027-04-15');
    expect(local(f.firstFallFrostMs)).toBe('2027-10-15');
  });

  it('always puts the last spring frost first, less than a year before the fall frost (property)', () => {
    const mmdd = fc
      .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([m, d]) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2100 }), mmdd, mmdd, (year, last, first) => {
        const f = frostDatesFromMmDd(year, last, first);
        const gap = (f.firstFallFrostMs - f.lastSpringFrostMs) / 86_400_000;
        return gap >= 0 && gap <= 366;
      })
    );
  });

  it('keeps each date within a year of the season year (property)', () => {
    const mmdd = fc
      .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([m, d]) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2100 }), mmdd, mmdd, (year, last, first) => {
        const f = frostDatesFromMmDd(year, last, first);
        const ly = new Date(f.lastSpringFrostMs).getFullYear();
        const fy = new Date(f.firstFallFrostMs).getFullYear();
        return ly >= year - 1 && ly <= year && fy >= year && fy <= year + 1;
      })
    );
  });
});
