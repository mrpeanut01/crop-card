import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlock } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { setSetting } from '$lib/db/settings';
import { runWithTenant } from '$lib/db/tenant';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { loadTodayWeather } from './todayWeather';
import { getForecast } from './weather';
import { resolveWeatherLocation } from './weatherHourly';

let latSeq = 0;
function freshLat(): number {
  latSeq += 1;
  return 30 + latSeq / 1000 + Math.random() / 1e6;
}

function freshOwner(): string {
  const id = `tw-test-${randomUUID().slice(0, 12)}`;
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  return id;
}

function period(
  startTime: string,
  isDaytime: boolean,
  temperature: number,
  shortForecast: string,
  pop = 0
) {
  return {
    number: 1,
    name: isDaytime ? 'Day' : 'Night',
    startTime,
    endTime: startTime,
    isDaytime,
    temperature,
    temperatureUnit: 'F',
    probabilityOfPrecipitation: { value: pop },
    windSpeed: isDaytime ? '8 mph' : '3 mph',
    shortForecast
  };
}

const EVENING_PERIODS = [
  period('2026-09-26T18:00:00-04:00', false, 54, 'Partly Cloudy'),
  period('2026-09-27T06:00:00-04:00', true, 71, 'Sunny'),
  period('2026-09-27T18:00:00-04:00', false, 50, 'Clear'),
  period('2026-09-28T06:00:00-04:00', true, 68, 'Chance Rain Showers', 40)
];

function mockNws(periods: unknown[] = EVENING_PERIODS): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const body = url.includes('/points/')
      ? { properties: { forecast: 'https://api.weather.gov/gridpoints/LWX/1,2/forecast' } }
      : { properties: { periods } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const SQUARE = JSON.stringify({
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getForecast daily collapse', () => {
  it('never reports 0°F for a night-only first day or a day-only last day', async () => {
    mockNws();
    const days = await getForecast(freshLat(), -77.5);
    expect(days.map((d) => d.date)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
    expect(days[0]).toMatchObject({
      highF: 54,
      lowF: 54,
      overnightOnly: true,
      shortForecast: 'Partly Cloudy',
      windMph: 3
    });
    expect(days[1]).toMatchObject({ highF: 71, lowF: 50, windMph: 8 });
    expect(days[1].overnightOnly).toBeUndefined();
    expect(days[2]).toMatchObject({ highF: 68, lowF: 68 });
  });
});

describe('resolveWeatherLocation farm fallback', () => {
  it('uses the saved farm location when no block is mapped', () => {
    runWithTenant(freshOwner(), () => {
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat: 40.5, lon: -80.1 }));
      createBlock({ name: 'Unmapped' });
      expect(resolveWeatherLocation(null)).toEqual({ lat: 40.5, lon: -80.1, source: 'farm' });
    });
  });
});

describe('loadTodayWeather', () => {
  it('asks for a location instead of showing the Loudoun default', async () => {
    const fetchMock = mockNws();
    const w = await runWithTenant(freshOwner(), () => loadTodayWeather());
    expect(w).toEqual({ status: 'needs-location' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the saved farm location when no block is mapped', async () => {
    const fetchMock = mockNws();
    const lat = freshLat();
    const w = await runWithTenant(freshOwner(), () => {
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat, lon: -80.1 }));
      return loadTodayWeather();
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.weather.gov/points/${lat},-80.1`);
    expect(w).toMatchObject({
      status: 'ok',
      source: 'farm',
      summary: { tempF: 54, tempKind: 'low', sky: 'partly-night' }
    });
  });

  it('prefers a mapped block over the farm location', async () => {
    mockNws();
    const w = await runWithTenant(freshOwner(), () => {
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat: 40.5, lon: -80.1 }));
      createBlock({ name: 'Mapped', geometryGeojson: SQUARE });
      return loadTodayWeather();
    });
    expect(w).toMatchObject({ status: 'ok', source: 'block' });
  });

  it('reports unavailable when NWS is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 }))
    );
    const lat = freshLat();
    const w = await runWithTenant(freshOwner(), () => {
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat, lon: -80.1 }));
      return loadTodayWeather();
    });
    expect(w).toEqual({ status: 'unavailable' });
  });
});
