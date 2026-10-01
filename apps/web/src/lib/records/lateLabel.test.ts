import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LATE_LEGEND, lateCells, lateLabel, UNTRACKED_LATE_CELLS } from './lateLabel';
import { daysLate } from '$lib/server/animalProductionGate';

const DAY = 86_400_000;

describe('lateLabel (G2-03)', () => {
  it('says nothing for a record saved on time', () => {
    expect(lateLabel(false, null)).toBeNull();
    expect(lateLabel(false, 4)).toBeNull();
  });

  it('names the days when they are known', () => {
    expect(lateLabel(true, 3)).toBe('Saved 3 days after its date');
    expect(lateLabel(true, 1)).toBe('Saved 1 day after its date');
  });

  it('drops the number when the flag is set but the count is not known', () => {
    expect(lateLabel(true, null)).toBe('Saved late');
    expect(lateLabel(true, 0)).toBe('Saved late');
    expect(lateLabel(true, Number.NaN)).toBe('Saved late');
  });

  it('only speaks when the flag is set, always about when it was saved', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.option(fc.integer({ min: -5, max: 4000 })), (flag, days) => {
        const label = lateLabel(flag, days ?? null);
        if (!flag) return label === null;
        return label !== null && /^Saved (late|\d+ days? after its date)$/.test(label);
      })
    );
    expect(LATE_LEGEND).not.toContain('\u2014');
  });

  it('agrees with the stored flag rule for every save gap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * DAY }), (gap) => {
        const count = daysLate(0, gap);
        const flagged = 0 < gap - 48 * 60 * 60 * 1000;
        return (count !== null) === flagged && (count === null || count >= 2);
      })
    );
  });
});

describe('lateCells (G2-08)', () => {
  it('is blank for a kind that does not track it', () => {
    expect(lateCells(undefined, 5)).toEqual(UNTRACKED_LATE_CELLS);
    expect(UNTRACKED_LATE_CELLS).toEqual({ recorded_late: '', days_after_date: '' });
  });

  it('says no with a blank day count for an on-time record', () => {
    expect(lateCells(false, null)).toEqual({ recorded_late: 'no', days_after_date: '' });
  });

  it('says yes with whole days for a late record', () => {
    expect(lateCells(true, 6)).toEqual({ recorded_late: 'yes', days_after_date: '6' });
    expect(lateCells(true, null)).toEqual({ recorded_late: 'yes', days_after_date: '' });
  });
});
