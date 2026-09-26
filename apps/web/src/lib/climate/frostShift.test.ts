import { describe, expect, it } from 'vitest';
import { colderFrostDates, shiftMmdd } from './frostShift';

describe('frost shift', () => {
  it('moves dates across month ends', () => {
    expect(shiftMmdd('04-28', 7)).toBe('05-05');
    expect(shiftMmdd('10-03', -7)).toBe('09-26');
    expect(shiftMmdd('13-01', 7)).toBeNull();
    expect(shiftMmdd('12-30', 7)).toBeNull();
  });

  it('pushes spring later and fall earlier for a colder spot', () => {
    expect(
      colderFrostDates(
        { lastFrost: '04-20', firstFrost: '10-20', lastHardFrost: '04-01', firstHardFrost: null },
        14
      )
    ).toEqual({ lastFrost: '05-04', firstFrost: '10-06', lastHardFrost: '04-15' });
  });
});
