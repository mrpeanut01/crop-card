import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  herbicideReEntry,
  reEntryActive,
  storedReEntryClearAt,
  tankReEntry
} from './herbicideReEntry';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 5, 1, 12);

const hoursArb = fc.array(fc.option(fc.integer({ min: 0, max: 240 }), { nil: undefined }), {
  minLength: 1,
  maxLength: 4
});

describe('tankReEntry', () => {
  it('takes the longest REI on file and says when one is missing', () => {
    expect(tankReEntry([12, 4])).toEqual({ longestHours: 12, complete: true });
    expect(tankReEntry([12, undefined])).toEqual({ longestHours: 12, complete: false });
    expect(tankReEntry([undefined, null])).toEqual({ longestHours: null, complete: false });
    expect(tankReEntry([])).toEqual({ longestHours: null, complete: false });
    expect(tankReEntry([Number.NaN, -1])).toEqual({ longestHours: null, complete: false });
  });
});

describe('storedReEntryClearAt', () => {
  it('stores a clear time only when every product has an REI', () => {
    expect(storedReEntryClearAt(T0, [12, 24])).toBe(T0 + 24 * HOUR);
    expect(storedReEntryClearAt(T0, [0])).toBe(T0);
    expect(storedReEntryClearAt(T0, [12, undefined])).toBeNull();
    expect(storedReEntryClearAt(T0, [undefined])).toBeNull();
  });
});

describe('herbicideReEntry', () => {
  it('is null when nothing is on file, so no window is invented', () => {
    expect(herbicideReEntry(T0, null, [undefined])).toBeNull();
    expect(reEntryActive(herbicideReEntry(T0, null, [undefined]), T0)).toBe(false);
  });

  it('runs from the library REI and ends after it', () => {
    const rei = herbicideReEntry(T0, null, [12]);
    expect(rei).toEqual({ clearAt: T0 + 12 * HOUR, complete: true });
    expect(reEntryActive(rei, T0 + 11 * HOUR)).toBe(true);
    expect(reEntryActive(rei, T0 + 13 * HOUR)).toBe(false);
  });

  it('keeps a stored clear time when the library has less or nothing', () => {
    expect(herbicideReEntry(T0, T0 + 24 * HOUR, [12])).toEqual({
      clearAt: T0 + 24 * HOUR,
      complete: true
    });
    expect(herbicideReEntry(T0, T0 + 24 * HOUR, [undefined])).toEqual({
      clearAt: T0 + 24 * HOUR,
      complete: true
    });
  });

  it('marks a partly known tank as not complete', () => {
    expect(herbicideReEntry(T0, null, [12, undefined])).toEqual({
      clearAt: T0 + 12 * HOUR,
      complete: false
    });
  });

  it('never ends before the stored clear time or any REI on file', () => {
    fc.assert(
      fc.property(
        hoursArb,
        fc.option(fc.integer({ min: 0, max: 240 }), { nil: null }),
        (hours, storedHours) => {
          const stored = storedHours === null ? null : T0 + storedHours * HOUR;
          const rei = herbicideReEntry(T0, stored, hours);
          const known = hours.filter((h): h is number => typeof h === 'number');
          if (stored === null && known.length === 0) return rei === null;
          if (!rei) return false;
          if (stored !== null && rei.clearAt < stored) return false;
          return known.every((h) => rei.clearAt >= T0 + h * HOUR);
        }
      )
    );
  });

  it('a stored clear time always matches what a full tank would store', () => {
    fc.assert(
      fc.property(hoursArb, (hours) => {
        const stored = storedReEntryClearAt(T0, hours);
        const tank = tankReEntry(hours);
        return tank.complete ? stored === T0 + tank.longestHours! * HOUR : stored === null;
      })
    );
  });
});
