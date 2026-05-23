/**
 * NOAA NWS forecast adapter (FR-22 weather provider).
 *
 * api.weather.gov is free, US-only, no auth, but requires a User-Agent.
 * Two-step lookup: lat/lon → grid endpoint → daily forecast. We round
 * lat/lon to 4 decimals (~11 m) for cache stability.
 *
 * Used in v1 only for **near-term confirmation** when a planting is
 * dropped within the next 7 days (e.g. "low of 38°F on day 3 — risky").
 * The drag-drop snap target uses climate normals (`./normals.ts`).
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { getFarmLatLon } from '$lib/schedule/settings';

const USER_AGENT = '(cropcard-pwa, ops@cropcard.local)';
const FORECAST_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ForecastDay {
  date: string;
  popPct: number;
  highF: number;
  lowF: number;
  windMph: number;
  shortForecast: string;
}

function cacheKeyFor(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Read the cache; return rows that haven't expired. */
function readCache(key: string): ForecastDay[] | null {
  const row = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!row) return null;
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt);
  if (Date.now() > expiresAt) return null;
  try {
    return JSON.parse(row.payloadJson) as ForecastDay[];
  } catch {
    return null;
  }
}

function writeCache(key: string, days: ForecastDay[]) {
  const now = Date.now();
  const expires = now + FORECAST_TTL_MS;
  const existing = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (existing) {
    db.update(weatherForecastCache)
      .set({
        fetchedAt: new Date(now),
        expiresAt: new Date(expires),
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
        expiresAt: new Date(expires),
        payloadJson: JSON.stringify(days)
      })
      .run();
  }
}

interface NwsPointResp {
  properties?: { forecast?: string };
}
interface NwsForecastPeriod {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  windSpeed?: string;
  shortForecast?: string;
  probabilityOfPrecipitation?: { value: number | null };
}
interface NwsForecastResp {
  properties?: { periods?: NwsForecastPeriod[] };
}

async function fetchPointForecastUrl(lat: number, lon: number): Promise<string | null> {
  const r = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }
  });
  if (!r.ok) return null;
  const j = (await r.json()) as NwsPointResp;
  return j.properties?.forecast ?? null;
}

function parseWindMph(s: string | undefined): number {
  if (!s) return 0;
  const m = /^(\d+)/.exec(s);
  return m ? Number(m[1]) : 0;
}

function aggregateDays(periods: NwsForecastPeriod[]): ForecastDay[] {
  const byDate = new Map<string, ForecastDay>();
  for (const p of periods) {
    const date = p.startTime.slice(0, 10);
    const cur = byDate.get(date) ?? {
      date,
      popPct: 0,
      highF: -Infinity,
      lowF: Infinity,
      windMph: 0,
      shortForecast: ''
    };
    if (p.isDaytime) {
      cur.highF = Math.max(cur.highF, p.temperature);
      cur.shortForecast = p.shortForecast ?? cur.shortForecast;
    } else {
      cur.lowF = Math.min(cur.lowF, p.temperature);
    }
    cur.popPct = Math.max(cur.popPct, p.probabilityOfPrecipitation?.value ?? 0);
    cur.windMph = Math.max(cur.windMph, parseWindMph(p.windSpeed));
    byDate.set(date, cur);
  }
  return [...byDate.values()]
    .map((d) => ({
      ...d,
      highF: Number.isFinite(d.highF) ? d.highF : (d.lowF as number),
      lowF: Number.isFinite(d.lowF) ? d.lowF : (d.highF as number)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch a 7-day forecast for the farm's lat/lon (or the supplied override).
 * Returns cached data when fresh; misses fall through to a live NWS call.
 */
export async function fetchForecast(opts?: {
  lat?: number;
  lon?: number;
  /** Set true to force a re-fetch even if cache is fresh (admin debug). */
  bypassCache?: boolean;
}): Promise<ForecastDay[]> {
  const { lat: latIn, lon: lonIn, bypassCache } = opts ?? {};
  const { lat, lon } =
    latIn !== undefined && lonIn !== undefined ? { lat: latIn, lon: lonIn } : getFarmLatLon();
  const key = cacheKeyFor(lat, lon);

  if (!bypassCache) {
    const cached = readCache(key);
    if (cached) return cached;
  }

  const forecastUrl = await fetchPointForecastUrl(lat, lon);
  if (!forecastUrl) return readCache(key) ?? [];
  const r = await fetch(forecastUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }
  });
  if (!r.ok) return readCache(key) ?? [];
  const j = (await r.json()) as NwsForecastResp;
  const days = aggregateDays(j.properties?.periods ?? []);
  if (days.length > 0) writeCache(key, days);
  return days;
}

/** Find a single ForecastDay by ISO date (`YYYY-MM-DD`). Used for the
 *  "low of X°F on this day" near-term confirmation chip in the drop UI. */
export function lookupForecastDay(
  forecast: ForecastDay[],
  dateISO: string
): ForecastDay | undefined {
  return forecast.find((d) => d.date === dateISO);
}
