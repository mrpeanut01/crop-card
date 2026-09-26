import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from '$lib/server/safeFetch';
import { validElevationFt } from './zone';

/**
 * Ground elevation for a point from the USGS Elevation Point Query Service
 * (3DEP, public domain). It only feeds the hardiness-zone station guard, so a
 * failure is simply "elevation unknown" and never an error.
 */

export const EPQS_HOST = 'epqs.nationalmap.gov';
export const EPQS_URL = `https://${EPQS_HOST}/v1/json`;
export const ELEVATION_TIMEOUT_MS = 4_000;
export const ELEVATION_MAX_BYTES = 4_096;
export const ELEVATION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const ELEVATION_MISS_TTL_MS = 6 * 60 * 60 * 1000;

export type ElevationFetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResponse>;

export function epqsUrl(lat: number, lon: number): string {
  const url = new URL(EPQS_URL);
  url.searchParams.set('x', lon.toFixed(5));
  url.searchParams.set('y', lat.toFixed(5));
  url.searchParams.set('wkid', '4326');
  url.searchParams.set('units', 'Feet');
  url.searchParams.set('includeDate', 'false');
  return url.toString();
}

/** EPQS answers 200 with a plain-text error for open water and outages, and
 *  a large negative sentinel for no data; all of those are null. */
export function parseEpqsFeet(text: string): number | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { value?: unknown }).value;
  const ft = typeof raw === 'string' ? Number(raw) : raw;
  return validElevationFt(ft);
}

function validPoint(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/** One EPQS request, host-pinned (no redirects), capped and timed out. Never throws. */
export async function fetchElevationFt(
  lat: number,
  lon: number,
  fetcher: ElevationFetcher = safeFetch
): Promise<number | null> {
  if (!validPoint(lat, lon)) return null;
  try {
    const res = await fetcher(epqsUrl(lat, lon), {
      timeoutMs: ELEVATION_TIMEOUT_MS,
      maxBytes: ELEVATION_MAX_BYTES,
      maxRedirects: 0,
      headers: { accept: 'application/json' }
    });
    if (res.status !== 200 || new URL(res.url).hostname !== EPQS_HOST) {
      res.cancel();
      return null;
    }
    const { text, truncated } = await res.readText();
    return truncated ? null : parseEpqsFeet(text);
  } catch {
    return null;
  }
}

export function elevationCacheKey(lat: number, lon: number): string {
  return `elev:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

type CacheRead = { hit: true; elevationFt: number | null } | { hit: false };

function readCache(key: string, now: number): CacheRead {
  const row = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!row || row.expiresAt.getTime() <= now) return { hit: false };
  try {
    const parsed = JSON.parse(row.payloadJson) as { elevationFt?: unknown };
    return { hit: true, elevationFt: validElevationFt(parsed?.elevationFt) };
  } catch {
    return { hit: false };
  }
}

function writeCache(key: string, now: number, elevationFt: number | null): void {
  const expiresAt = new Date(
    now + (elevationFt === null ? ELEVATION_MISS_TTL_MS : ELEVATION_TTL_MS)
  );
  const payloadJson = JSON.stringify({ elevationFt, source: 'usgs-3dep-epqs' });
  db.insert(weatherForecastCache)
    .values({ id: randomUUID(), cacheKey: key, fetchedAt: new Date(now), expiresAt, payloadJson })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { fetchedAt: new Date(now), expiresAt, payloadJson }
    })
    .run();
}

const inFlight = new Map<string, Promise<number | null>>();

/** Elevation for a location, cached in the global location-keyed weather
 *  cache for a year (6 h for a miss). Null when unknown. */
export function elevationFtAt(
  lat: number,
  lon: number,
  opts: { fetcher?: ElevationFetcher; now?: number } = {}
): Promise<number | null> {
  if (!validPoint(lat, lon)) return Promise.resolve(null);
  const key = elevationCacheKey(lat, lon);
  const now = opts.now ?? Date.now();
  const cached = readCache(key, now);
  if (cached.hit) return Promise.resolve(cached.elevationFt);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = fetchElevationFt(lat, lon, opts.fetcher)
    .then((ft) => {
      writeCache(key, now, ft);
      return ft;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const WINDOW_MS = 60_000;
export const ELEVATION_PER_MINUTE = 30;
const hits = new Map<string, number[]>();

/** In-process sliding window (single replica, Invariant 3). */
export function allowElevationLookup(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= ELEVATION_PER_MINUTE) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return true;
}

export function resetElevationRateLimit(): void {
  hits.clear();
}
