import { like } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { HOUR_MS } from '$lib/weather/leafWet';
import type { Connector, RawResponse, Resolver } from './safeFetch';
import nceiRows from './__fixtures__/ncei-ghcnh-kjyo.json';
import nwsObs from './__fixtures__/nws-observations-kjyo.json';
import {
  CLOSED_MONTH_TTL_MS,
  getObservedHours,
  isNceiAdsUrl,
  monthStarts,
  nceiFetchText,
  nceiRowsToHourly,
  nceiUrl,
  nearestObservedStations,
  nwsObservationsToHourly,
  observedMonthKey,
  OPEN_MONTH_TTL_MS,
  passesGhcnhQc,
  stationLabel,
  type NceiRow,
  type NwsObservationsResponse
} from './weatherObserved';

const LEESBURG = { lat: 39.1157, lon: -77.5636 };
const NOW = Date.UTC(2026, 8, 26, 14);
const FROM = Date.UTC(2026, 8, 20);

function clearObservedCache() {
  db.delete(weatherForecastCache).where(like(weatherForecastCache.cacheKey, 'observed%')).run();
}

beforeEach(clearObservedCache);

describe('nearestObservedStations', () => {
  it('picks Leesburg Executive (KJYO) first for a Leesburg farm', () => {
    const s = nearestObservedStations(LEESBURG.lat, LEESBURG.lon);
    expect(s[0]).toMatchObject({ icao: 'KJYO', ghcnId: 'USW00003714' });
    expect(s[0].distanceMiles).toBeCloseTo(2.6, 0);
    expect(s[1].icao).toBe('KIAD');
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it('returns nothing far from any US station', () => {
    expect(nearestObservedStations(30, -40)).toEqual([]);
  });
});

describe('stationLabel', () => {
  it('title-cases the name and keeps AP', () => {
    expect(stationLabel({ name: 'LEESBURG EXECUTIVE AP', icao: 'KJYO' })).toBe(
      'Leesburg Executive AP (KJYO)'
    );
  });
});

describe('passesGhcnhQc', () => {
  it.each(['', undefined, '0', '1', '4', '5', '9', 'A', 'U', 'M'])('accepts %j', (c) => {
    expect(passesGhcnhQc(c)).toBe(true);
  });
  it.each(['2', '3', '6', '7', 'n', 's', 'k'])('rejects %j', (c) => {
    expect(passesGhcnhQc(c)).toBe(false);
  });
});

describe('nceiRowsToHourly (recorded KJYO GHCNh rows, 2026-09-20..21)', () => {
  const hours = nceiRowsToHourly(nceiRows as NceiRow[]);

  it('buckets the 20-minute AWOS reports into one point per hour', () => {
    expect(hours.length).toBeGreaterThanOrEqual(47);
    expect(hours.length).toBeLessThanOrEqual(49);
    for (let i = 1; i < hours.length; i++) expect(hours[i].t - hours[i - 1].t).toBe(HOUR_MS);
    expect(hours.every((h) => h.t % HOUR_MS === 0)).toBe(true);
  });

  it('converts °C to °F and averages the reports in the hour', () => {
    const rows = (nceiRows as NceiRow[]).filter((r) => {
      const ms = Date.parse(`${r.DATE}Z`);
      return Math.abs(ms - Date.UTC(2026, 8, 20, 12)) <= 30 * 60 * 1000;
    });
    const temps = rows.map((r) => Number(r.temperature));
    const meanC = temps.reduce((a, b) => a + b, 0) / temps.length;
    const meanF = (meanC * 9) / 5 + 32;
    const h = hours.find((x) => x.t === Date.UTC(2026, 8, 20, 12))!;
    expect(h.tempF).toBeCloseTo(meanF, 1);
    expect(h.rhPct).not.toBeNull();
    expect(h.precipMm).toBeNull();
    expect(h.popPct).toBeNull();
  });

  it('drops values that failed QC and rows without a date', () => {
    const out = nceiRowsToHourly([
      { DATE: '2026-09-20T00:00:00', temperature: '40.0', temperature_Quality_Code: '3' },
      { DATE: '2026-09-20T00:05:00', temperature: '10.0', relative_humidity: '95' },
      { temperature: '12.0' }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ t: Date.UTC(2026, 8, 20, 0), tempF: 50, rhPct: 95 });
  });
});

describe('nwsObservationsToHourly (recorded KJYO observations)', () => {
  it('yields hourly points in °F from degC readings', () => {
    const hours = nwsObservationsToHourly(nwsObs as NwsObservationsResponse);
    expect(hours.length).toBeGreaterThan(30);
    expect(hours.every((h) => h.tempF === null || (h.tempF > 20 && h.tempF < 110))).toBe(true);
  });

  it('skips X/Q-flagged values', () => {
    const out = nwsObservationsToHourly({
      features: [
        {
          properties: {
            timestamp: '2026-09-25T10:15:00+00:00',
            temperature: { unitCode: 'wmoUnit:degC', value: 50, qualityControl: 'X' },
            relativeHumidity: { value: 80, qualityControl: 'V' }
          }
        }
      ]
    });
    expect(out).toEqual([
      expect.objectContaining({ t: Date.UTC(2026, 8, 25, 10), tempF: null, rhPct: 80 })
    ]);
  });
});

describe('NCEI URL + fetch', () => {
  it('builds a pinned Access Data Service URL', () => {
    const url = nceiUrl('USW00003714', Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 1));
    expect(isNceiAdsUrl(url)).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('dataset')).toBe('global-historical-climatology-network-hourly');
    expect(q.get('stations')).toBe('USW00003714');
    expect(q.get('startDate')).toBe('2026-09-01T00:00:00');
    expect(q.get('dataTypes')).toContain('DATE');
  });

  const publicResolver: Resolver = async () => [{ address: '205.167.25.177', family: 4 }];
  function reply(status: number, text: string, headers: Record<string, string> = {}): Connector {
    return async () =>
      ({
        status,
        headers,
        body: (async function* () {
          yield new TextEncoder().encode(text);
        })(),
        destroy() {}
      }) satisfies RawResponse;
  }

  it('refuses any other host', async () => {
    const fetchText = nceiFetchText({ resolver: publicResolver, connector: reply(200, '[]') });
    await expect(fetchText('https://evil.test/access/services/data/v1?x=1')).rejects.toThrow(
      /non-NCEI/
    );
  });

  it('returns the body on 200', async () => {
    const fetchText = nceiFetchText({ resolver: publicResolver, connector: reply(200, '[]') });
    await expect(fetchText(nceiUrl('USW00003714', FROM, NOW))).resolves.toBe('[]');
  });

  it('does not follow redirects', async () => {
    const fetchText = nceiFetchText({
      resolver: publicResolver,
      connector: reply(302, '', { location: 'https://elsewhere.test/' })
    });
    await expect(fetchText(nceiUrl('USW00003714', FROM, NOW))).rejects.toThrow();
  });

  it('rejects a truncated body', async () => {
    const fetchText = nceiFetchText({
      resolver: publicResolver,
      connector: reply(200, 'x'.repeat(100)),
      maxBytes: 10
    });
    await expect(fetchText(nceiUrl('USW00003714', FROM, NOW))).rejects.toThrow(/size cap/);
  });
});

describe('monthStarts', () => {
  it('covers every UTC month touched by the range', () => {
    expect(monthStarts(Date.UTC(2025, 10, 15), Date.UTC(2026, 1, 2))).toEqual([
      Date.UTC(2025, 10, 1),
      Date.UTC(2025, 11, 1),
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 1, 1)
    ]);
  });
});

describe('getObservedHours', () => {
  const nceiText = () => vi.fn(async (_url: string) => JSON.stringify(nceiRows));
  const nwsObservations = () => vi.fn(async () => nwsObs as NwsObservationsResponse);

  it('joins GHCNh with NWS observations for the latency gap, tagged data', async () => {
    const n = nceiText();
    const w = nwsObservations();
    const r = await getObservedHours(LEESBURG.lat, LEESBURG.lon, FROM, NOW, {
      nceiText: n,
      nwsObservations: w
    });
    expect(r.provenance).toBe('data');
    expect(r.station?.icao).toBe('KJYO');
    expect(r.sources).toEqual(['ghcnh', 'nws-obs']);
    expect(n).toHaveBeenCalledTimes(1);
    expect(String(n.mock.calls[0][0])).toContain('stations=USW00003714');
    expect(w).toHaveBeenCalledWith('KJYO', NOW - 7 * 24 * HOUR_MS);
    expect(r.hours[0].t).toBe(FROM);
    expect(r.latestMs).toBe(r.hours[r.hours.length - 1].t);
    expect(r.hours.some((h) => h.t >= Date.UTC(2026, 8, 25))).toBe(true);
    expect(r.hours.every((h) => h.t <= NOW)).toBe(true);
  });

  it('serves repeat calls from the cache', async () => {
    await getObservedHours(LEESBURG.lat, LEESBURG.lon, FROM, NOW, {
      nceiText: nceiText(),
      nwsObservations: nwsObservations()
    });
    const n = nceiText();
    const w = nwsObservations();
    const r = await getObservedHours(LEESBURG.lat, LEESBURG.lon, FROM, NOW + 60_000, {
      nceiText: n,
      nwsObservations: w
    });
    expect(n).not.toHaveBeenCalled();
    expect(w).not.toHaveBeenCalled();
    expect(r.provenance).toBe('data');
  });

  it('caches a settled month long and the current month briefly', async () => {
    await getObservedHours(LEESBURG.lat, LEESBURG.lon, Date.UTC(2026, 6, 20), NOW, {
      nceiText: vi.fn(async () => '[]'),
      nwsObservations: nwsObservations()
    });
    const rows = db.select().from(weatherForecastCache).all();
    const ttl = (key: string) => {
      const row = rows.find((x) => x.cacheKey === key)!;
      return row.expiresAt.getTime() - row.fetchedAt.getTime();
    };
    expect(ttl(observedMonthKey('USW00003714', Date.UTC(2026, 6, 1)))).toBe(CLOSED_MONTH_TTL_MS);
    expect(ttl(observedMonthKey('USW00003714', Date.UTC(2026, 8, 1)))).toBe(OPEN_MONTH_TTL_MS);
  });

  it('still returns NWS observations when NCEI fails', async () => {
    const r = await getObservedHours(LEESBURG.lat, LEESBURG.lon, FROM, NOW, {
      nceiText: vi.fn(async () => {
        throw new Error('NCEI down');
      }),
      nwsObservations: nwsObservations()
    });
    expect(r.provenance).toBe('data');
    expect(r.sources).toEqual(['nws-obs']);
  });

  it('falls back without trying other stations when both feeds are down', async () => {
    const n = vi.fn(async () => {
      throw new Error('NCEI down');
    });
    const w = vi.fn(async () => {
      throw new Error('NWS down');
    });
    const r = await getObservedHours(LEESBURG.lat, LEESBURG.lon, FROM, NOW, {
      nceiText: n,
      nwsObservations: w
    });
    expect(r).toMatchObject({ provenance: 'fallback', hours: [], sources: [] });
    expect(r.error).toMatch(/down/);
    expect(w).toHaveBeenCalledTimes(1);
  });

  it('moves to the next station when the nearest one has no records', async () => {
    const n = vi.fn(async (url: string) =>
      url.includes('USW00003714') ? '[]' : JSON.stringify(nceiRows)
    );
    const w = vi.fn(async (icao: string) =>
      icao === 'KJYO' ? { features: [] } : (nwsObs as NwsObservationsResponse)
    );
    const r = await getObservedHours(LEESBURG.lat, LEESBURG.lon, FROM, NOW, {
      nceiText: n,
      nwsObservations: w
    });
    expect(r.provenance).toBe('data');
    expect(r.station?.icao).toBe('KIAD');
  });

  it('falls back with no nearby station', async () => {
    const n = nceiText();
    const r = await getObservedHours(30, -40, FROM, NOW, { nceiText: n });
    expect(r.provenance).toBe('fallback');
    expect(r.station).toBeNull();
    expect(n).not.toHaveBeenCalled();
  });

  it('returns nothing for a start in the future', async () => {
    const r = await getObservedHours(LEESBURG.lat, LEESBURG.lon, NOW + HOUR_MS, NOW, {});
    expect(r).toMatchObject({ provenance: 'fallback', hours: [], error: null });
  });
});
