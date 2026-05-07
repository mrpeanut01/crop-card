/**
 * NOAA National Weather Service forecast adapter (FR-22).
 *
 * Two-step API per NWS docs:
 *   1. GET /points/{lat},{lon}    → returns the per-grid forecast URL
 *   2. GET that forecast URL      → returns 7-day period array
 *
 * We collapse the 14 12-hour periods into a 3-day daily summary the hay
 * engine consumes. Cached in the `weather_forecast_cache` table for 1 hr
 * to stay polite with the rate limit (NWS asks for User-Agent identification
 * and ≤5 req/sec).
 *
 * Server-only. Fetch failures are surfaced as a structured error so the
 * UI can render "weather unavailable; mow at your own discretion" rather
 * than silently passing the gate.
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import type { ForecastDay } from '$lib/hay/types';

const NWS_BASE = 'https://api.weather.gov';
const USER_AGENT = 'cropcard.farm (cropcard-app, contact: github.com/mrpeanut01/crop-card)';
const CACHE_TTL_MS = 60 * 60 * 1000;

export class WeatherFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WeatherFetchError';
  }
}

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

interface NwsPointsResponse {
  properties: {
    forecast: string;
  };
}

interface NwsPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: 'F' | 'C';
  probabilityOfPrecipitation?: { value: number | null };
  windSpeed: string;
  shortForecast: string;
}

interface NwsForecastResponse {
  properties: {
    periods: NwsPeriod[];
  };
}

async function nwsFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/geo+json'
    }
  });
  if (!res.ok) {
    throw new WeatherFetchError(`NWS fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  return (await res.json()) as T;
}

/**
 * Convert NWS's alternating day/night periods into a daily summary.
 * Each calendar day pairs one "daytime" period (high) with the following
 * "night" period (low + overnight rain).
 */
function periodsToDays(periods: NwsPeriod[]): ForecastDay[] {
  const byDate = new Map<string, ForecastDay>();
  for (const p of periods) {
    const date = p.startTime.slice(0, 10);
    const existing = byDate.get(date) ?? {
      date,
      popPct: 0,
      highF: -Infinity,
      lowF: Infinity,
      shortForecast: undefined as string | undefined
    };
    if (p.temperatureUnit === 'F') {
      if (p.isDaytime) {
        existing.highF = Math.max(existing.highF, p.temperature);
        existing.shortForecast = p.shortForecast;
      } else {
        existing.lowF = Math.min(existing.lowF, p.temperature);
      }
    }
    const pop = p.probabilityOfPrecipitation?.value ?? 0;
    if (pop > existing.popPct) existing.popPct = pop;
    const wind = parseFloat(p.windSpeed);
    if (!Number.isNaN(wind) && p.isDaytime) existing.windMph = wind;
    byDate.set(date, existing);
  }
  // Replace +/-Infinity with NaN-equivalent rounded values.
  return Array.from(byDate.values())
    .map((d) => ({
      date: d.date,
      popPct: d.popPct,
      highF: Number.isFinite(d.highF) ? d.highF : 0,
      lowF: Number.isFinite(d.lowF) ? d.lowF : 0,
      windMph: d.windMph,
      shortForecast: d.shortForecast
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Public entry point: returns up to a 7-day forecast for the given lat/lon,
 * cached for 1 hr. Throws WeatherFetchError on network failure.
 */
export async function getForecast(lat: number, lon: number): Promise<ForecastDay[]> {
  const key = cacheKey(lat, lon);
  const now = Date.now();
  const cached = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (cached && cached.expiresAt.getTime() > now) {
    return JSON.parse(cached.payloadJson) as ForecastDay[];
  }

  const points = await nwsFetch<NwsPointsResponse>(`${NWS_BASE}/points/${lat},${lon}`);
  const forecast = await nwsFetch<NwsForecastResponse>(points.properties.forecast);
  const days = periodsToDays(forecast.properties.periods);

  const expiresAt = new Date(now + CACHE_TTL_MS);
  if (cached) {
    db.update(weatherForecastCache)
      .set({
        fetchedAt: new Date(now),
        expiresAt,
        payloadJson: JSON.stringify(days)
      })
      .where(eq(weatherForecastCache.cacheKey, key))
      .run();
  } else {
    db.insert(weatherForecastCache)
      .values({
        id: randomUUID(),
        cacheKey: key,
        fetchedAt: new Date(now),
        expiresAt,
        payloadJson: JSON.stringify(days)
      })
      .run();
  }
  return days;
}

/**
 * Pull a centroid out of a GeoJSON Polygon / MultiPolygon / Feature so we
 * can ask NOAA for a single forecast per block. Returns null if the geometry
 * is unparseable; the caller falls back to a farm-level default lat/lon.
 */
export function geometryCentroid(raw: string): { lat: number; lon: number } | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const coords = collectCoords(obj);
    if (coords.length === 0) return null;
    const lonSum = coords.reduce((a, c) => a + c[0], 0);
    const latSum = coords.reduce((a, c) => a + c[1], 0);
    return { lat: latSum / coords.length, lon: lonSum / coords.length };
  } catch {
    return null;
  }
}

function collectCoords(g: unknown): [number, number][] {
  if (!g || typeof g !== 'object') return [];
  const obj = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown };
  if (obj.type === 'Feature') return collectCoords(obj.geometry);
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return obj.features.flatMap(collectCoords);
  }
  if (obj.type === 'Polygon' && Array.isArray(obj.coordinates)) {
    const ring = (obj.coordinates as unknown[][])[0];
    return Array.isArray(ring) ? (ring as [number, number][]) : [];
  }
  if (obj.type === 'MultiPolygon' && Array.isArray(obj.coordinates)) {
    const out: [number, number][] = [];
    for (const poly of obj.coordinates as unknown[][][]) {
      const ring = poly[0];
      if (Array.isArray(ring)) out.push(...(ring as [number, number][]));
    }
    return out;
  }
  return [];
}
