/**
 * Hourly NWS gridpoint feed (Phase 29 / #132). `/points` → `forecastGridData`
 * returns per-parameter series whose `validTime` is an ISO-8601 interval
 * ("2026-09-25T14:00:00+00:00/PT3H"); we expand those into one point per
 * hour. Cached in the global, location-keyed `weather_forecast_cache` under
 * `hourly:<lat>,<lon>` for 1 h. Server-only; pure derivations live in
 * `$lib/weather/leafWet`.
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getBlock, geometryCentroid, listBlocks } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { fetchNwsPoints, nwsFetch, WeatherFetchError } from '$lib/server/weather';
import { floorHour, HOUR_MS, type HourlyPoint, type WeatherProvenance } from '$lib/weather/leafWet';

export const HOURLY_CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface NwsGridValue {
  validTime: string;
  value: number | null;
}

export interface NwsGridSeries {
  uom?: string;
  values: NwsGridValue[];
}

export interface NwsGridpointResponse {
  properties: {
    updateTime?: string;
    temperature?: NwsGridSeries;
    dewpoint?: NwsGridSeries;
    relativeHumidity?: NwsGridSeries;
    probabilityOfPrecipitation?: NwsGridSeries;
    quantitativePrecipitation?: NwsGridSeries;
    windSpeed?: NwsGridSeries;
  };
}

export interface HourlyForecast {
  hours: HourlyPoint[];
  fetchedAt: number;
  provenance: WeatherProvenance;
}

export function hourlyCacheKey(lat: number, lon: number): string {
  return `hourly:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** ISO-8601 duration (PnDTnHnM, PnW) → whole hours, rounded up. Null when unparseable. */
export function parseIsoDurationHours(duration: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!m || duration === 'P' || duration.endsWith('T')) return null;
  const [, w, d, h, min, s] = m.map((x) => (x ? Number(x) : 0));
  const totalMinutes = w * 7 * 24 * 60 + d * 24 * 60 + h * 60 + min + s / 60;
  if (totalMinutes <= 0) return null;
  return Math.ceil(totalMinutes / 60);
}

/** "start/duration" → per-hour start timestamps (ms epoch, floored to the hour). */
export function expandValidTime(validTime: string): number[] {
  const [startRaw, durRaw] = validTime.split('/');
  if (!startRaw || !durRaw) return [];
  const start = Date.parse(startRaw);
  const hours = parseIsoDurationHours(durRaw);
  if (Number.isNaN(start) || hours === null) return [];
  const first = floorHour(start);
  return Array.from({ length: hours }, (_, i) => first + i * HOUR_MS);
}

type Converter = (v: number) => number;
const round1 = (v: number) => Math.round(v * 10) / 10;

function tempConverter(uom?: string): Converter {
  return uom && /degF/i.test(uom) ? round1 : (c) => round1((c * 9) / 5 + 32);
}
function speedConverter(uom?: string): Converter {
  if (uom && /km_h/i.test(uom)) return (k) => round1(k * 0.621371);
  if (uom && /m_s/i.test(uom)) return (m) => round1(m * 2.23694);
  return round1;
}
function precipConverter(uom?: string): Converter {
  if (uom && /(^|:)in$/i.test(uom)) return (i) => Math.round(i * 25.4 * 100) / 100;
  return (mm) => Math.round(mm * 100) / 100;
}

type Field = 'tempF' | 'dewpointF' | 'rhPct' | 'popPct' | 'precipMm' | 'windMph';

/** Expand every series into per-hour points. QPF is an interval total and is split evenly across its hours. */
export function gridpointToHourly(grid: NwsGridpointResponse): HourlyPoint[] {
  const byT = new Map<number, HourlyPoint>();
  const at = (t: number): HourlyPoint => {
    let p = byT.get(t);
    if (!p) {
      p = {
        t,
        tempF: null,
        dewpointF: null,
        rhPct: null,
        popPct: null,
        precipMm: null,
        windMph: null
      };
      byT.set(t, p);
    }
    return p;
  };
  const apply = (
    series: NwsGridSeries | undefined,
    field: Field,
    conv: Converter,
    split = false
  ) => {
    if (!series?.values) return;
    for (const v of series.values) {
      if (v.value === null || typeof v.value !== 'number') continue;
      const ts = expandValidTime(v.validTime);
      if (ts.length === 0) continue;
      const each = split ? v.value / ts.length : v.value;
      for (const t of ts) at(t)[field] = conv(each);
    }
  };
  const p = grid.properties ?? {};
  apply(p.temperature, 'tempF', tempConverter(p.temperature?.uom));
  apply(p.dewpoint, 'dewpointF', tempConverter(p.dewpoint?.uom));
  apply(p.relativeHumidity, 'rhPct', round1);
  apply(p.probabilityOfPrecipitation, 'popPct', round1);
  apply(
    p.quantitativePrecipitation,
    'precipMm',
    precipConverter(p.quantitativePrecipitation?.uom),
    true
  );
  apply(p.windSpeed, 'windMph', speedConverter(p.windSpeed?.uom));
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

function readCache(key: string, now: number): HourlyForecast | null {
  const cached = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!cached || cached.expiresAt.getTime() <= now) return null;
  try {
    const hours = JSON.parse(cached.payloadJson) as HourlyPoint[];
    if (!Array.isArray(hours)) return null;
    return { hours, fetchedAt: cached.fetchedAt.getTime(), provenance: 'data' };
  } catch {
    return null;
  }
}

function writeCache(key: string, now: number, hours: HourlyPoint[]): void {
  const expiresAt = new Date(now + HOURLY_CACHE_TTL_MS);
  const payloadJson = JSON.stringify(hours);
  db.insert(weatherForecastCache)
    .values({ id: randomUUID(), cacheKey: key, fetchedAt: new Date(now), expiresAt, payloadJson })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { fetchedAt: new Date(now), expiresAt, payloadJson }
    })
    .run();
}

/** Hourly points for a location, cached 1 h. Throws WeatherFetchError on network/shape failure. */
export async function getHourlyForecast(
  lat: number,
  lon: number,
  now: number = Date.now()
): Promise<HourlyForecast> {
  const key = hourlyCacheKey(lat, lon);
  const cached = readCache(key, now);
  if (cached) return cached;

  let hours: HourlyPoint[];
  try {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const points = await fetchNwsPoints(lat, lon, { signal });
    const gridUrl = points.properties?.forecastGridData;
    if (!gridUrl) throw new WeatherFetchError('NWS points response has no forecastGridData');
    const grid = await nwsFetch<NwsGridpointResponse>(gridUrl, { signal });
    hours = gridpointToHourly(grid);
  } catch (e) {
    if (e instanceof WeatherFetchError) throw e;
    throw new WeatherFetchError('NWS hourly fetch failed', e);
  }
  if (hours.length === 0)
    throw new WeatherFetchError('NWS gridpoint response had no hourly values');
  writeCache(key, now, hours);
  return { hours, fetchedAt: now, provenance: 'data' };
}

/** Never throws: returns `provenance: 'fallback'` with no hours when the feed is unavailable. */
export async function getHourlyForecastSafely(
  lat: number,
  lon: number,
  now: number = Date.now()
): Promise<HourlyForecast & { error: string | null }> {
  try {
    return { ...(await getHourlyForecast(lat, lon, now)), error: null };
  } catch (e) {
    return {
      hours: [],
      fetchedAt: now,
      provenance: 'fallback',
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

export type WeatherLocationSource = 'block' | 'farm-block' | 'farm' | 'farm-default';

export interface WeatherLocation {
  lat: number;
  lon: number;
  source: WeatherLocationSource;
}

/**
 * Block centroid → first block with geometry → saved farm location →
 * Loudoun default (`farm-default`, which callers may treat as "unknown"). Block reads go through the tenant-scoped repo, so a foreign
 * blockId resolves to `null` (caller 404s).
 */
export function resolveWeatherLocation(blockId?: string | null): WeatherLocation | null {
  if (blockId) {
    const block = getBlock(blockId);
    if (!block) return null;
    const c = block.geometryGeojson ? geometryCentroid(block.geometryGeojson) : null;
    if (c) return { lat: c.lat, lon: c.lon, source: 'block' };
  }
  for (const b of listBlocks()) {
    const c = b.geometryGeojson ? geometryCentroid(b.geometryGeojson) : null;
    if (c) return { lat: c.lat, lon: c.lon, source: 'farm-block' };
  }
  const farm = getFarmLatLon();
  return { lat: farm.lat, lon: farm.lon, source: hasFarmLatLon() ? 'farm' : 'farm-default' };
}
