import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkRainfast,
  dailyLeafWetHours,
  dailyRainTotals,
  DEFAULT_RAINFAST_HOURS,
  deriveHourly,
  findDryWindow,
  HOUR_MS,
  hasPrecip,
  isDryHour,
  isLeafWet,
  leafWetHoursInRange,
  summarizeLeafWet,
  tankMixRainfastHours,
  type HourlyPoint
} from './leafWet';

const T0 = Date.UTC(2026, 8, 25, 12);

function pt(i: number, over: Partial<HourlyPoint> = {}): HourlyPoint {
  return {
    t: T0 + i * HOUR_MS,
    tempF: 70,
    dewpointF: 55,
    rhPct: 60,
    popPct: 5,
    precipMm: 0,
    windMph: 5,
    ...over
  };
}

const hourArb = fc.record({
  rhPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  popPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  precipMm: fc.option(fc.oneof(fc.constant(0), fc.double({ min: 0, max: 20, noNaN: true })), {
    nil: null
  })
});

const seriesArb = fc
  .array(fc.tuple(fc.integer({ min: -72, max: 200 }), hourArb), { maxLength: 240 })
  .map((rows) => rows.map(([i, h]) => pt(i, h)));

describe('isLeafWet / isDryHour', () => {
  it('RH ≥ 90 counts as wet; 89 does not', () => {
    expect(isLeafWet(pt(0, { rhPct: 90 }))).toBe(true);
    expect(isLeafWet(pt(0, { rhPct: 89 }))).toBe(false);
  });
  it('measurable precip counts as wet even at low RH', () => {
    expect(isLeafWet(pt(0, { rhPct: 50, precipMm: 0.2 }))).toBe(true);
  });
  it('unknown RH without precip is not wet', () => {
    expect(isLeafWet(pt(0, { rhPct: null }))).toBe(false);
  });
  it('dry hour requires every field known and below thresholds', () => {
    expect(isDryHour(pt(0))).toBe(true);
    expect(isDryHour(pt(0, { popPct: 30 }))).toBe(false);
    expect(isDryHour(pt(0, { rhPct: 90 }))).toBe(false);
    expect(isDryHour(pt(0, { precipMm: 0.1 }))).toBe(false);
    expect(isDryHour(pt(0, { precipMm: null }))).toBe(false);
    expect(isDryHour(pt(0, { popPct: null }))).toBe(false);
  });
});

describe('leaf-wet counting', () => {
  it('counts wet hours inside [start, end) only', () => {
    const hours = [pt(-2, { rhPct: 95 }), pt(-1, { rhPct: 95 }), pt(0, { rhPct: 95 }), pt(1)];
    expect(leafWetHoursInRange(hours, T0 - 2 * HOUR_MS, T0)).toEqual({
      wetHours: 2,
      coveredHours: 2
    });
  });
  it('dedupes repeated timestamps', () => {
    const hours = [pt(0, { rhPct: 95 }), pt(0, { rhPct: 95 })];
    expect(leafWetHoursInRange(hours, T0, T0 + HOUR_MS).wetHours).toBe(1);
  });
  it('summarizes past/next windows around now', () => {
    const hours = Array.from({ length: 96 }, (_, i) => pt(i - 48, { rhPct: i % 2 ? 95 : 50 }));
    const s = summarizeLeafWet(hours, T0 + 10 * 60 * 1000);
    expect(s.past24h).toEqual({ wetHours: 12, coveredHours: 24 });
    expect(s.next48h).toEqual({ wetHours: 24, coveredHours: 48 });
  });
  it('property: wet ≤ covered ≤ window length', () => {
    fc.assert(
      fc.property(seriesArb, (hours) => {
        const s = summarizeLeafWet(hours, T0);
        for (const [w, n] of [
          [s.past24h, 24],
          [s.next24h, 24],
          [s.past48h, 48],
          [s.next48h, 48]
        ] as const) {
          expect(w.wetHours).toBeLessThanOrEqual(w.coveredHours);
          expect(w.coveredHours).toBeLessThanOrEqual(n);
        }
      })
    );
  });
  it('property: per-day wet hours sum ≤ 24 (UTC) and ≤ covered hours', () => {
    fc.assert(
      fc.property(seriesArb, (hours) => {
        for (const d of dailyLeafWetHours(hours, 'UTC')) {
          expect(d.value).toBeLessThanOrEqual(d.coveredHours);
          expect(d.coveredHours).toBeLessThanOrEqual(24);
        }
      })
    );
  });
});

describe('dailyRainTotals', () => {
  it('sums precip per local day, from today, max 5 days', () => {
    const hours = Array.from({ length: 24 * 8 }, (_, i) => pt(i, { precipMm: 0.5 }));
    const days = dailyRainTotals(hours, T0, 5, 'UTC');
    expect(days).toHaveLength(5);
    expect(days[0].date).toBe('2026-09-25');
    expect(days[0].value).toBe(6);
    expect(days[1].value).toBe(12);
  });
  it('treats unknown precip as 0 but still reports coverage', () => {
    const days = dailyRainTotals([pt(0, { precipMm: null })], T0, 5, 'UTC');
    expect(days).toEqual([{ date: '2026-09-25', value: 0, coveredHours: 1 }]);
  });
});

describe('findDryWindow', () => {
  it('returns the first window of minHours dry hours', () => {
    const hours = [
      pt(0, { precipMm: 1 }),
      pt(1),
      pt(2, { popPct: 50 }),
      pt(3),
      pt(4),
      pt(5),
      pt(6),
      pt(7)
    ];
    expect(findDryWindow(hours, { fromMs: T0, minHours: 4 })).toEqual({
      startMs: T0 + 3 * HOUR_MS,
      endMs: T0 + 7 * HOUR_MS,
      hours: 4
    });
  });
  it('a data gap breaks contiguity', () => {
    const hours = [pt(0), pt(1), pt(3), pt(4)];
    expect(findDryWindow(hours, { fromMs: T0, minHours: 3 })).toBeNull();
  });
  it('starts at the hour containing fromMs', () => {
    const hours = [pt(0), pt(1), pt(2)];
    const w = findDryWindow(hours, { fromMs: T0 + 30 * 60 * 1000, minHours: 2 });
    expect(w?.startMs).toBe(T0);
  });
  it('returns null on empty input', () => {
    expect(findDryWindow([], { fromMs: T0 })).toBeNull();
  });
  it('property: a window never overlaps a wet, precip, or high-PoP hour', () => {
    fc.assert(
      fc.property(
        seriesArb,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 100 }),
        (hours, minHours, maxPopPct) => {
          const w = findDryWindow(hours, { fromMs: T0, minHours, maxPopPct });
          if (!w) return;
          expect(w.endMs - w.startMs).toBe(minHours * HOUR_MS);
          expect(w.startMs).toBeGreaterThanOrEqual(T0);
          for (let t = w.startMs; t < w.endMs; t += HOUR_MS) {
            const atT = hours.filter((h) => h.t === t);
            expect(atT.length).toBeGreaterThan(0);
            const last = atT[atT.length - 1];
            expect(hasPrecip(last)).toBe(false);
            expect(isLeafWet(last)).toBe(false);
            expect(last.popPct!).toBeLessThan(maxPopPct);
          }
        }
      )
    );
  });
});

describe('checkRainfast', () => {
  it('clear when every hour in the window is dry', () => {
    const hours = Array.from({ length: 6 }, (_, i) => pt(i));
    expect(checkRainfast(hours, T0, 4).status).toBe('clear');
  });
  it('rain-risk on PoP ≥ threshold or measurable precip inside the window', () => {
    const hours = [pt(0), pt(1), pt(2, { popPct: 60 }), pt(3)];
    const r = checkRainfast(hours, T0, 4);
    expect(r.status).toBe('rain-risk');
    expect(r.firstRiskMs).toBe(T0 + 2 * HOUR_MS);
    expect(r.maxPopPct).toBe(60);
  });
  it('rain after the window does not count', () => {
    const hours = [pt(0), pt(1), pt(2), pt(3), pt(4, { precipMm: 3 })];
    expect(checkRainfast(hours, T0, 4).status).toBe('clear');
  });
  it('unknown when coverage is incomplete', () => {
    expect(checkRainfast([pt(0)], T0, 4).status).toBe('unknown');
    expect(checkRainfast([], T0, 4).status).toBe('unknown');
  });
});

describe('tankMixRainfastHours', () => {
  it('defaults to 4h when no label value', () => {
    expect(tankMixRainfastHours([{}, { rainfastHours: null }])).toEqual({
      hours: DEFAULT_RAINFAST_HOURS,
      fromLabel: false
    });
  });
  it('takes the longest label interval', () => {
    expect(tankMixRainfastHours([{ rainfastHours: 1 }, { rainfastHours: 6 }, {}])).toEqual({
      hours: 6,
      fromLabel: true
    });
  });
});

describe('deriveHourly', () => {
  it('produces a fully-unknown result for empty fallback input', () => {
    const d = deriveHourly([], 'fallback', { nowMs: T0 });
    expect(d.provenance).toBe('fallback');
    expect(d.rainfast.status).toBe('unknown');
    expect(d.dryWindow).toBeNull();
    expect(d.dailyRain).toEqual([]);
    expect(d.leafWet.next24h.coveredHours).toBe(0);
  });
});
