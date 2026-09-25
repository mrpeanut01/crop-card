import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { nextSunrise, sunTimesFor } from './sunTimes';

const LEESBURG = { lat: 39.1157, lon: -77.5636 };
const FIVE_MIN = 5 * 60_000;

function expectNear(actual: Date | undefined, expectedIso: string) {
  expect(actual).toBeDefined();
  const diff = Math.abs(actual!.getTime() - Date.parse(expectedIso));
  expect(diff, `${actual!.toISOString()} vs ${expectedIso}`).toBeLessThanOrEqual(FIVE_MIN);
}

describe('sunTimesFor — Leesburg VA reference values (±5 min)', () => {
  it('March equinox 2026', () => {
    const s = sunTimesFor(LEESBURG.lat, LEESBURG.lon, new Date('2026-03-20T16:00:00Z'));
    expectNear(s?.sunrise, '2026-03-20T11:12:00Z');
    expectNear(s?.sunset, '2026-03-20T23:21:00Z');
  });

  it('June solstice 2026 (sunset falls on the next UTC date)', () => {
    const s = sunTimesFor(LEESBURG.lat, LEESBURG.lon, new Date('2026-06-21T16:00:00Z'));
    expectNear(s?.sunrise, '2026-06-21T09:44:00Z');
    expectNear(s?.sunset, '2026-06-22T00:40:00Z');
  });

  it('December solstice 2026', () => {
    const s = sunTimesFor(LEESBURG.lat, LEESBURG.lon, new Date('2026-12-21T16:00:00Z'));
    expectNear(s?.sunrise, '2026-12-21T12:26:00Z');
    expectNear(s?.sunset, '2026-12-21T21:50:00Z');
  });

  it('an evening local time (after 00:00 UTC) still resolves to the same local day', () => {
    const s = sunTimesFor(LEESBURG.lat, LEESBURG.lon, new Date('2026-06-22T02:00:00Z'));
    expectNear(s?.sunrise, '2026-06-21T09:44:00Z');
  });

  it('returns null for polar day / polar night and invalid input', () => {
    expect(sunTimesFor(78, 15, new Date('2026-06-21T12:00:00Z'))).toBeNull();
    expect(sunTimesFor(78, 15, new Date('2026-12-21T12:00:00Z'))).toBeNull();
    expect(sunTimesFor(Number.NaN, 0, new Date())).toBeNull();
    expect(sunTimesFor(95, 0, new Date())).toBeNull();
    expect(sunTimesFor(39, 0, new Date(Number.NaN))).toBeNull();
  });
});

describe('nextSunrise', () => {
  it('returns today’s sunrise before dawn and tomorrow’s after', () => {
    const preDawn = new Date('2026-06-21T08:00:00Z');
    expectNear(
      nextSunrise(LEESBURG.lat, LEESBURG.lon, preDawn) ?? undefined,
      '2026-06-21T09:44:00Z'
    );
    const evening = new Date('2026-06-22T01:30:00Z');
    expectNear(
      nextSunrise(LEESBURG.lat, LEESBURG.lon, evening) ?? undefined,
      '2026-06-22T09:44:00Z'
    );
  });
});

describe('sunTimesFor — properties', () => {
  const at = fc.date({
    min: new Date('2000-01-01'),
    max: new Date('2060-12-31'),
    noInvalidDate: true
  });
  const midLat = fc.double({ min: -60, max: 60, noNaN: true });
  const lon = fc.double({ min: -180, max: 180, noNaN: true });

  it('sunrise precedes sunset and the day is between 8 and 17 hours at |lat| ≤ 50', () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), lon, at, (la, lo, d) => {
        const s = sunTimesFor(la, lo, d);
        expect(s).not.toBeNull();
        const hours = (s!.sunset.getTime() - s!.sunrise.getTime()) / 3_600_000;
        expect(hours).toBeGreaterThan(8);
        expect(hours).toBeLessThan(17);
      })
    );
  });

  it('the solar day containing `at` brackets it within ±24 h of sunrise', () => {
    fc.assert(
      fc.property(midLat, lon, at, (la, lo, d) => {
        const s = sunTimesFor(la, lo, d);
        if (!s) return;
        expect(Math.abs(d.getTime() - s.sunrise.getTime())).toBeLessThan(24 * 3_600_000);
      })
    );
  });

  it('nextSunrise is strictly after `at` and within 24 h', () => {
    fc.assert(
      fc.property(midLat, lon, at, (la, lo, d) => {
        const n = nextSunrise(la, lo, d);
        if (!n) return;
        expect(n.getTime()).toBeGreaterThan(d.getTime());
        expect(n.getTime() - d.getTime()).toBeLessThanOrEqual(24 * 3_600_000 + FIVE_MIN);
      })
    );
  });
});
