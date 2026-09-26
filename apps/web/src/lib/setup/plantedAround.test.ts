import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dateForMonth, plantingDateMs, recentMonths, ymd } from './plantedAround';

const NOW = new Date(2026, 8, 26, 10, 30);

describe('recentMonths', () => {
  it('lists the last twelve months, newest first', () => {
    const months = recentMonths(NOW);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ key: '2026-09', label: 'September 2026' });
    expect(months[8]).toEqual({ key: '2026-01', label: 'January 2026' });
    expect(months[11]).toEqual({ key: '2025-10', label: 'October 2025' });
  });

  it('crosses the year boundary from January', () => {
    const months = recentMonths(new Date(2027, 0, 3), 3);
    expect(months.map((m) => m.key)).toEqual(['2027-01', '2026-12', '2026-11']);
  });
});

describe('dateForMonth', () => {
  it('picks the middle of a past month', () => {
    expect(dateForMonth('2026-05', NOW)).toBe('2026-05-15');
  });

  it('never picks a date after today', () => {
    expect(dateForMonth('2026-09', new Date(2026, 8, 3))).toBe('2026-09-03');
    expect(dateForMonth('2026-09', NOW)).toBe('2026-09-15');
  });

  it('rejects malformed keys', () => {
    expect(dateForMonth('2026-13', NOW)).toBeNull();
    expect(dateForMonth('May 2026', NOW)).toBeNull();
  });

  it('always returns a date that plantingDateMs accepts for every recent month', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1) }), (now) => {
        if (Number.isNaN(now.getTime())) return;
        for (const m of recentMonths(now)) {
          const d = dateForMonth(m.key, now);
          expect(d).not.toBeNull();
          expect(plantingDateMs(d!, now)).not.toBeNull();
        }
      })
    );
  });
});

describe('plantingDateMs', () => {
  it('lands on local noon of the chosen day', () => {
    const ms = plantingDateMs('2026-05-15', NOW)!;
    const d = new Date(ms);
    expect(ymd(d)).toBe('2026-05-15');
    expect(d.getHours()).toBe(12);
  });

  it('accepts today and rejects tomorrow', () => {
    expect(plantingDateMs('2026-09-26', NOW)).not.toBeNull();
    expect(plantingDateMs('2026-09-27', NOW)).toBeNull();
  });

  it('rejects impossible dates', () => {
    expect(plantingDateMs('2026-02-30', NOW)).toBeNull();
    expect(plantingDateMs('', NOW)).toBeNull();
  });
});
