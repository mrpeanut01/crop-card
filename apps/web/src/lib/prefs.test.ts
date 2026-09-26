import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  UNITS,
  formatCalendarDate,
  formatInstant,
  formatLabelRate,
  formatQuantity,
  fromDisplay,
  toDisplay,
  todayYmd,
  ymdInZone,
  type Quantity
} from './prefs';

const us = { timeZone: 'America/New_York', units: 'us' as const };
const metric = { timeZone: 'America/New_York', units: 'metric' as const };

describe('calendar dates never shift with the zone', () => {
  it.each(['Pacific/Honolulu', 'America/New_York', 'UTC', 'Pacific/Kiritimati'])('%s', () => {
    expect(formatCalendarDate('2026-05-01')).toBe('May 1, 2026');
    expect(formatCalendarDate('2026-05-01T00:00:00.000Z')).toBe('May 1, 2026');
    expect(formatCalendarDate(Date.UTC(2026, 0, 31), 'month-day')).toBe('Jan 31');
  });

  it('renders empty and garbage as a dash', () => {
    expect(formatCalendarDate(null)).toBe('—');
    expect(formatCalendarDate('')).toBe('—');
    expect(formatCalendarDate('not a date')).toBe('—');
  });
});

describe('instants follow the user zone', () => {
  const at = Date.UTC(2026, 6, 2, 2, 30); // 10:30 PM EDT on Jul 1

  it('formats in the chosen zone', () => {
    expect(formatInstant(at, us, 'date')).toBe('Jul 1, 2026');
    expect(formatInstant(at, { ...us, timeZone: 'UTC' }, 'date')).toBe('Jul 2, 2026');
    expect(formatInstant(at, { ...us, timeZone: 'America/Los_Angeles' }, 'time')).toBe('7:30 PM');
  });

  it('computes the local day', () => {
    expect(ymdInZone(at, 'America/New_York')).toBe('2026-07-01');
    expect(ymdInZone(at, 'UTC')).toBe('2026-07-02');
    expect(todayYmd(us, at)).toBe('2026-07-01');
  });
});

describe('unit conversion', () => {
  it('uses the standard factors', () => {
    expect(toDisplay(1, 'area', metric)).toBeCloseTo(0.404686, 5);
    expect(toDisplay(100, 'weightPerArea', metric)).toBeCloseTo(112.085, 2);
    expect(toDisplay(15, 'volumePerArea', metric)).toBeCloseTo(140.31, 1);
    expect(toDisplay(212, 'temperature', metric)).toBeCloseTo(100, 6);
    expect(toDisplay(18, 'temperatureDelta', metric)).toBeCloseTo(10, 6);
    expect(toDisplay(10, 'speed', metric)).toBeCloseTo(16.0934, 3);
    expect(toDisplay(1, 'precip', metric)).toBe(25.4);
    expect(toDisplay(30, 'length', metric)).toBeCloseTo(76.2, 6);
    expect(toDisplay(32000, 'perArea', metric)).toBeCloseTo(79073.7, 0);
  });

  it('is the identity for US users', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(UNITS) as Quantity[])),
        fc.double({ noNaN: true, min: -1e6, max: 1e6 }),
        (q, v) => {
          expect(toDisplay(v, q, us)).toBe(v);
          expect(fromDisplay(v, q, us)).toBe(v);
        }
      )
    );
  });

  it('round-trips metric input back to the stored value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(UNITS) as Quantity[])),
        fc.double({ noNaN: true, min: -1e6, max: 1e6 }),
        (q, v) => {
          const back = fromDisplay(toDisplay(v, q, metric), q, metric);
          expect(back).toBeCloseTo(v, 6);
        }
      )
    );
  });
});

describe('formatting', () => {
  it('suffixes the right unit', () => {
    expect(formatQuantity(12.5, 'area', us)).toBe('12.5 ac');
    expect(formatQuantity(12.5, 'area', metric)).toBe('5.06 ha');
    expect(formatQuantity(68, 'temperature', metric)).toBe('20°C');
    expect(formatQuantity(1234, 'weight', us)).toBe('1,234 lb');
    expect(formatQuantity(12.5, 'area', metric, { bare: true })).toBe('5.06');
    expect(formatQuantity(null, 'area', us)).toBe('—');
    expect(formatQuantity(Number.NaN, 'area', us)).toBe('—');
  });

  it('keeps the label unit first for label rates', () => {
    expect(formatLabelRate(22, 'flOzPerArea', us)).toBe('22 fl oz/ac');
    expect(formatLabelRate(22, 'flOzPerArea', metric)).toBe('22 fl oz/ac (1,608 mL/ha)');
    expect(formatLabelRate(null, 'flOzPerArea', metric)).toBe('—');
  });
});
