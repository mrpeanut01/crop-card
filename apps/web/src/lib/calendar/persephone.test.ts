import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  daylightHours,
  hasShortDays,
  shortDayBandLabel,
  shortDaySpans,
  SHORT_DAY_HOURS
} from './persephone';

const LEESBURG = { lat: 39.137, lon: -77.714 };
const MOBILE = { lat: 30.69, lon: -88.04 };
const ALBION_ME = { lat: 44.53, lon: -69.44 };
const DAY = 86_400_000;

function month(ms: number) {
  const d = new Date(ms);
  return { m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

describe('daylightHours', () => {
  it('is near 9.4 hours at the December solstice in Leesburg and near 14.9 in June', () => {
    expect(daylightHours(LEESBURG.lat, LEESBURG.lon, Date.UTC(2025, 11, 21, 17))).toBeCloseTo(
      9.43,
      1
    );
    expect(daylightHours(LEESBURG.lat, LEESBURG.lon, Date.UTC(2025, 5, 21, 17))).toBeCloseTo(
      14.9,
      1
    );
  });
});

describe('shortDaySpans', () => {
  it('needs a farm location', () => {
    expect(shortDaySpans(null, null, 0, DAY)).toEqual({ status: 'no-location' });
  });

  it('says days never drop under 10 hours on the Gulf coast', () => {
    expect(hasShortDays(MOBILE.lat, MOBILE.lon)).toBe(false);
    expect(
      shortDaySpans(MOBILE.lat, MOBILE.lon, Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1))
    ).toEqual({ status: 'never' });
  });

  it('gives one span from early November to early February in Loudoun', () => {
    const r = shortDaySpans(LEESBURG.lat, LEESBURG.lon, Date.UTC(2025, 7, 1), Date.UTC(2026, 7, 1));
    expect(r.status).toBe('spans');
    if (r.status !== 'spans') return;
    expect(r.spans).toHaveLength(1);
    const start = month(r.spans[0].startMs);
    const end = month(r.spans[0].endMs);
    expect(start.m).toBe(11);
    expect(start.d).toBeGreaterThanOrEqual(15);
    expect(end.m).toBe(1);
    expect(end.d).toBeGreaterThanOrEqual(20);
  });

  it('matches the Maine example: about Nov 6 to Feb 6 at 44.5 N', () => {
    const r = shortDaySpans(
      ALBION_ME.lat,
      ALBION_ME.lon,
      Date.UTC(2025, 7, 1),
      Date.UTC(2026, 7, 1)
    );
    if (r.status !== 'spans') throw new Error(r.status);
    const s = new Date(r.spans[0].startMs);
    const e = new Date(r.spans[0].endMs);
    expect(Math.abs(s.getTime() - Date.UTC(2025, 10, 6))).toBeLessThan(3 * DAY);
    expect(Math.abs(e.getTime() - Date.UTC(2026, 1, 6))).toBeLessThan(3 * DAY);
  });

  it('puts the short days in June in the southern hemisphere', () => {
    const r = shortDaySpans(-42.9, 147.3, Date.UTC(2025, 0, 1), Date.UTC(2025, 11, 31));
    if (r.status !== 'spans') throw new Error(r.status);
    expect(r.spans).toHaveLength(1);
    const mid = (r.spans[0].startMs + r.spans[0].endMs) / 2;
    expect(new Date(mid).getUTCMonth()).toBe(5);
  });

  it('clips spans to the window and every day in a span is under the threshold', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 33, max: 60, noNaN: true }),
        fc.double({ min: -125, max: -66, noNaN: true }),
        fc.integer({ min: 0, max: 300 }),
        (lat, lon, offsetDays) => {
          const from = Date.UTC(2025, 0, 1) + offsetDays * DAY;
          const to = from + 200 * DAY;
          const r = shortDaySpans(lat, lon, from, to);
          if (r.status !== 'spans') return;
          for (const s of r.spans) {
            expect(s.startMs).toBeGreaterThanOrEqual(from);
            expect(s.endMs).toBeLessThanOrEqual(to);
            for (let t = s.startMs + DAY / 2; t < s.endMs - DAY / 2; t += 7 * DAY) {
              expect(daylightHours(lat, lon, t)!).toBeLessThan(SHORT_DAY_HOURS + 0.05);
            }
          }
        }
      ),
      { numRuns: 40 }
    );
  });
});

describe('shortDayBandLabel', () => {
  it('names the 10-hour line', () => {
    expect(shortDayBandLabel()).toMatch(/under 10 hours of daylight$/);
  });
});
