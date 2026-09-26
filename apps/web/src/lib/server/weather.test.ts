import { describe, expect, it } from 'vitest';
import forecastLwx from './__fixtures__/nws-forecast-lwx.json';
import forecastMob from './__fixtures__/nws-forecast-mob.json';
import forecastBzn from './__fixtures__/nws-forecast-tfx-bozeman.json';
import { geometryCentroid, parseWindMph, periodsToDays, type NwsForecastResponse } from './weather';

describe('parseWindMph', () => {
  it.each([
    ['5 mph', 5],
    ['14 to 21 mph', 21],
    ['0 to 5 mph', 5],
    ['0 mph', 0]
  ])('%j → %i', (raw, mph) => {
    expect(parseWindMph(raw)).toBe(mph);
  });

  it.each([undefined, null, '', 'calm', 12])('returns null for %j', (raw) => {
    expect(parseWindMph(raw)).toBeNull();
  });
});

// Live api.weather.gov /forecast responses recorded 2026-09-26.
describe('periodsToDays on recorded forecasts', () => {
  it.each([
    ['LWX (Leesburg, VA)', forecastLwx, { date: '2026-09-26', highF: 70, lowF: 58, windMph: 21 }],
    ['MOB (Mobile, AL)', forecastMob, { date: '2026-09-26', highF: 88, lowF: 69, windMph: 5 }],
    ['TFX (Bozeman, MT)', forecastBzn, { date: '2026-09-26', highF: 64, lowF: 41, windMph: 8 }]
  ] as const)('%s collapses 14 periods into daily highs and lows', (_label, body, first) => {
    const days = periodsToDays((body as NwsForecastResponse).properties.periods);
    expect(days.length).toBeGreaterThanOrEqual(7);
    expect(days[0]).toMatchObject(first);
    for (const d of days) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(d.highF)).toBe(true);
      expect(Number.isFinite(d.lowF)).toBe(true);
      expect(d.popPct).toBeGreaterThanOrEqual(0);
      expect(d.popPct).toBeLessThanOrEqual(100);
      expect(d.shortForecast).toBeTruthy();
    }
    expect(days.at(-1)!.overnightOnly).toBeUndefined();
  });
});

describe('geometryCentroid', () => {
  it('returns mean lat/lon for a Polygon ring', () => {
    const polygon = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.6, 39.1],
          [-77.6, 39.2],
          [-77.5, 39.2],
          [-77.5, 39.1],
          [-77.6, 39.1]
        ]
      ]
    });
    const c = geometryCentroid(polygon);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(39.16, 1);
    expect(c!.lon).toBeCloseTo(-77.56, 1);
  });

  it('handles a Feature wrapping the geometry', () => {
    const feat = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-77.6, 39.1],
            [-77.5, 39.1],
            [-77.5, 39.2],
            [-77.6, 39.2],
            [-77.6, 39.1]
          ]
        ]
      }
    });
    const c = geometryCentroid(feat);
    expect(c).not.toBeNull();
  });

  it('handles a MultiPolygon (uses outer ring of each polygon)', () => {
    const mp = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-77.6, 39.1],
            [-77.5, 39.1],
            [-77.5, 39.2],
            [-77.6, 39.2],
            [-77.6, 39.1]
          ]
        ],
        [
          [
            [-77.4, 39.0],
            [-77.3, 39.0],
            [-77.3, 39.1],
            [-77.4, 39.1],
            [-77.4, 39.0]
          ]
        ]
      ]
    });
    const c = geometryCentroid(mp);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeGreaterThan(38.9);
    expect(c!.lat).toBeLessThan(39.3);
  });

  it('returns null for malformed JSON', () => {
    expect(geometryCentroid('not json')).toBeNull();
  });

  it('returns null for unsupported geometry types', () => {
    const point = JSON.stringify({ type: 'Point', coordinates: [-77.6, 39.1] });
    expect(geometryCentroid(point)).toBeNull();
  });
});
