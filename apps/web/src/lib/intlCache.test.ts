import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  __intlCacheForTests,
  dateTimeFormat,
  dateToLocaleDateString,
  dateToLocaleString,
  dateToLocaleTimeString,
  numberToLocaleString
} from './intlCache';
import {
  formatCalendarDate,
  formatInstant,
  formatQuantity,
  ymdInZone,
  zoneAbbrev,
  type DateStyle
} from './prefs';
import { localStamp } from './exports/localTime';
import { zonedDayStartMs } from './exports/dateRange';

const ZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
  'America/St_Johns',
  'Europe/London',
  'Australia/Lord_Howe',
  'Asia/Kolkata',
  'Pacific/Kiritimati',
  'UTC'
];

// DST transitions and day/year boundaries, in UTC.
const EDGES = [
  Date.UTC(2026, 2, 8, 6, 59, 59), // US spring-forward, one second before
  Date.UTC(2026, 2, 8, 7, 0, 0), // US spring-forward
  Date.UTC(2026, 10, 1, 5, 59, 59), // US fall-back, first 1:59
  Date.UTC(2026, 10, 1, 6, 0, 0), // US fall-back, second 1:00
  Date.UTC(2026, 2, 29, 1, 0, 0), // EU spring-forward
  Date.UTC(2026, 9, 25, 1, 0, 0), // EU fall-back
  Date.UTC(2026, 3, 4, 15, 0, 0), // Lord Howe half-hour shift
  Date.UTC(2025, 11, 31, 23, 59, 59),
  Date.UTC(2026, 0, 1, 0, 0, 0),
  Date.UTC(2026, 0, 1, 4, 59, 59),
  Date.UTC(2024, 1, 29, 12, 0, 0),
  0,
  Date.UTC(2026, 8, 26, 0, 0, 0)
];

const DATE_OPTIONS: Intl.DateTimeFormatOptions[] = [
  {},
  { hour12: false },
  { month: 'short', day: 'numeric', year: 'numeric' },
  { month: 'numeric', day: 'numeric', year: '2-digit' },
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  { weekday: 'short' },
  { month: 'short', day: 'numeric' },
  { hour: 'numeric', minute: '2-digit' },
  { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  { hour: 'numeric', hourCycle: 'h23' },
  { timeZoneName: 'short' },
  { dayPeriod: 'short' }
];

describe('intlCache date helpers match the native methods', () => {
  for (const timeZone of ZONES) {
    it(`toLocaleString / DateString / TimeString in ${timeZone}`, () => {
      for (const ms of EDGES) {
        const d = new Date(ms);
        for (const base of DATE_OPTIONS) {
          const opts = { ...base, timeZone };
          for (const locale of ['en-US', 'sv-SE', 'en-CA']) {
            expect(dateToLocaleString(d, locale, opts)).toBe(d.toLocaleString(locale, opts));
            expect(dateToLocaleDateString(d, locale, opts)).toBe(
              d.toLocaleDateString(locale, opts)
            );
            expect(dateToLocaleTimeString(d, locale, opts)).toBe(
              d.toLocaleTimeString(locale, opts)
            );
          }
        }
      }
    });
  }

  it('matches for arbitrary instants and zones (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2060, 0, 1) }),
        fc.constantFrom(...ZONES),
        (ms, timeZone) => {
          const d = new Date(ms);
          const opts = { hour12: false, timeZone };
          expect(dateToLocaleString(d, 'sv-SE', opts)).toBe(d.toLocaleString('sv-SE', opts));
        }
      ),
      { numRuns: 500 }
    );
  });

  it('reports Invalid Date like the native method', () => {
    const bad = new Date(Number.NaN);
    expect(dateToLocaleString(bad, 'en-US')).toBe(bad.toLocaleString('en-US'));
    expect(dateToLocaleDateString(bad, 'en-US')).toBe(bad.toLocaleDateString('en-US'));
    expect(dateToLocaleTimeString(bad, 'en-US')).toBe(bad.toLocaleTimeString('en-US'));
  });

  it('throws on an unknown zone like the native method', () => {
    const d = new Date(0);
    expect(() => d.toLocaleString('en-US', { timeZone: 'Mars/Olympus' })).toThrow(RangeError);
    expect(() => dateToLocaleString(d, 'en-US', { timeZone: 'Mars/Olympus' })).toThrow(RangeError);
  });
});

describe('intlCache number helper matches the native method', () => {
  it('for fraction-digit options (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }),
        fc.integer({ min: 0, max: 4 }),
        (v, digits) => {
          const opts = { maximumFractionDigits: digits, minimumFractionDigits: 0 };
          expect(numberToLocaleString(v, 'en-US', opts)).toBe(v.toLocaleString('en-US', opts));
          const max = { maximumFractionDigits: digits };
          expect(numberToLocaleString(v, 'en-US', max)).toBe(v.toLocaleString('en-US', max));
        }
      ),
      { numRuns: 500 }
    );
  });

  it('for special values', () => {
    for (const v of [0, -0, 0.5, 1.005, 2.5, 1234567.891, Infinity, -Infinity, Number.NaN]) {
      expect(numberToLocaleString(v, 'en-US', { maximumFractionDigits: 2 })).toBe(
        v.toLocaleString('en-US', { maximumFractionDigits: 2 })
      );
    }
  });
});

describe('intlCache reuse and bounds', () => {
  it('returns the same formatter for the same locale and options', () => {
    const a = dateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric' });
    const b = dateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric' });
    expect(a).toBe(b);
    expect(dateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric' })).not.toBe(a);
  });

  it('never holds more than the cap', () => {
    __intlCacheForTests.clear();
    for (let i = 0; i < __intlCacheForTests.maxEntries + 50; i++) {
      numberToLocaleString(1, 'en-US', {
        maximumFractionDigits: i % 21,
        minimumIntegerDigits: 1 + (i % 21)
      });
      dateToLocaleString(new Date(0), 'en-US', {
        timeZone: ZONES[i % ZONES.length],
        hour: 'numeric',
        minute: i % 2 ? 'numeric' : '2-digit',
        second: i % 3 ? 'numeric' : '2-digit',
        era: i % 5 ? 'short' : 'long',
        weekday: (['short', 'long', 'narrow'] as const)[i % 3]
      });
    }
    const { date, number } = __intlCacheForTests.sizes();
    expect(date).toBeLessThanOrEqual(__intlCacheForTests.maxEntries);
    expect(number).toBeLessThanOrEqual(__intlCacheForTests.maxEntries);
  });
});

describe('prefs formatters keep their output', () => {
  const STYLES: DateStyle[] = [
    'date',
    'date-short',
    'date-long',
    'weekday',
    'month-day',
    'time',
    'datetime'
  ];
  const NATIVE: Record<DateStyle, Intl.DateTimeFormatOptions> = {
    date: { month: 'short', day: 'numeric', year: 'numeric' },
    'date-short': { month: 'numeric', day: 'numeric', year: '2-digit' },
    'date-long': { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
    weekday: { weekday: 'short' },
    'month-day': { month: 'short', day: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit' },
    datetime: {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }
  };

  it('formatInstant, formatCalendarDate, ymdInZone, zoneAbbrev, localStamp', () => {
    for (const timeZone of ZONES) {
      const prefs = { timeZone, units: 'us' as const };
      for (const ms of EDGES) {
        const d = new Date(ms);
        for (const style of STYLES) {
          expect(formatInstant(ms, prefs, style)).toBe(
            d.toLocaleString('en-US', { ...NATIVE[style], timeZone })
          );
        }
        expect(formatInstant(ms, prefs, 'date-long', { year: undefined })).toBe(
          d.toLocaleString('en-US', { ...NATIVE['date-long'], year: undefined, timeZone })
        );
        expect(ymdInZone(ms, timeZone)).toBe(d.toLocaleString('sv-SE', { timeZone }).slice(0, 10));
        expect(zoneAbbrev(prefs, ms)).toBe(
          new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
            .formatToParts(d)
            .find((p) => p.type === 'timeZoneName')?.value
        );
        expect(localStamp(ms, prefs)).toBe(
          d.toLocaleString('sv-SE', { hour12: false, timeZone }).slice(0, 16)
        );
      }
    }
    for (const ms of EDGES) {
      const d = new Date(ms);
      expect(formatCalendarDate(ms)).toBe(
        d.toLocaleDateString('en-US', { ...NATIVE.date, timeZone: 'UTC' })
      );
    }
  });

  it('pins known strings', () => {
    const ny = { timeZone: 'America/New_York', units: 'us' as const };
    expect(localStamp(Date.UTC(2026, 10, 1, 5, 30), ny)).toBe('2026-11-01 01:30');
    expect(localStamp(Date.UTC(2026, 10, 1, 6, 30), ny)).toBe('2026-11-01 01:30');
    expect(localStamp(Date.UTC(2026, 2, 8, 7, 0), ny)).toBe('2026-03-08 03:00');
    expect(localStamp(Date.UTC(2026, 0, 1, 4, 59), ny)).toBe('2025-12-31 23:59');
    expect(ymdInZone(Date.UTC(2026, 0, 1, 4, 59), 'America/New_York')).toBe('2025-12-31');
    expect(ymdInZone(Date.UTC(2026, 0, 1, 4, 59), 'Asia/Kolkata')).toBe('2026-01-01');
    expect(formatInstant(Date.UTC(2026, 6, 4, 16, 5), ny)).toMatch(/^Jul 4, 2026, 12:05\sPM$/);
    expect(formatQuantity(1234.567, 'area', ny)).toBe('1,234.57 ac');
    expect(formatQuantity(12, 'temperature', { units: 'metric' })).toBe('-11°C');
    expect(zonedDayStartMs(2026, 3, 8, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 5, 0));
    expect(zonedDayStartMs(2026, 11, 1, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 4, 0));
  });
});
