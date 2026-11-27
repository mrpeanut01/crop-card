import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { realNow } from '$lib/server/clock';
import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from '$lib/server/safeFetch';
import { weatherFeedsOff } from '$lib/server/weather';
import { METERS_PER_DEG_LAT, localFrame, boxCenter, validBox } from '$lib/siteFinder/geometry';
import {
  TERRAIN_GRID_N,
  TERRAIN_GRID_N_SMALL,
  gridPoints,
  validElevationM,
  type TerrainGrid,
  type TerrainLookup
} from '$lib/siteFinder/terrain';
import type { SearchBox } from '$lib/siteFinder/types';

/**
 * A small grid of ground elevations over a Find a spot search box, from the
 * USGS 3DEP elevation image service (public domain, no key). One request per
 * box. It only feeds the slope and facing direction of each spot, so a
 * failure is "terrain unknown" and the finder treats the ground as level;
 * it is never an error. Nothing here is an AI call.
 */

export const TERRAIN_HOST = 'elevation.nationalmap.gov';
export const TERRAIN_SAMPLES_URL = `https://${TERRAIN_HOST}/arcgis/rest/services/3DEPElevation/ImageServer/getSamples`;
export const TERRAIN_TIMEOUT_MS = 6_000;
export const TERRAIN_MAX_BYTES = 256_000;
/** A request longer than this drops to the smaller grid. */
export const TERRAIN_MAX_URL_LENGTH = 3_500;
export const TERRAIN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const TERRAIN_UNAVAILABLE_TTL_MS = 5 * 60 * 1000;
/** With fewer known points than this the service has no elevations here. */
export const TERRAIN_MIN_KNOWN_POINTS = 4;
/** The slope the e2e fixture makes, and the way it faces. */
export const TERRAIN_FIXTURE_SLOPE_PCT = 12;
export const TERRAIN_FIXTURE_ASPECT_DEG = 0;
export const TERRAIN_FIXTURE_RESOLUTION_M = 1;

export type TerrainFetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResponse>;

/** The box the grid is sampled for: the corners rounded to about a metre,
 *  so the same cache entry always means the same sample points. */
export function terrainBox(box: SearchBox): SearchBox {
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return {
    minLon: r(box.minLon),
    minLat: r(box.minLat),
    maxLon: r(box.maxLon),
    maxLat: r(box.maxLat)
  };
}

export function terrainCacheKey(box: SearchBox, n: number): string {
  const b = terrainBox(box);
  return `terrain:${n}:${b.minLon.toFixed(5)},${b.minLat.toFixed(5)},${b.maxLon.toFixed(5)},${b.maxLat.toFixed(5)}`;
}

/** The one request this module sends. The only variable parts are the grid
 *  points, written as numbers with fixed decimals. */
export function terrainUrl(box: SearchBox, n: number): string {
  if (!validBox(box)) throw new RangeError('terrain box out of range');
  const points = gridPoints(box, n).map(([lon, lat]) => [
    Number(lon.toFixed(6)),
    Number(lat.toFixed(6))
  ]);
  const url = new URL(TERRAIN_SAMPLES_URL);
  url.searchParams.set('geometry', JSON.stringify({ points, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType', 'esriGeometryMultipoint');
  url.searchParams.set('returnFirstValueOnly', 'true');
  url.searchParams.set('f', 'json');
  return url.toString();
}

/** The grid size whose request stays under the length cap. */
export function terrainGridSize(box: SearchBox): number {
  return terrainUrl(box, TERRAIN_GRID_N).length <= TERRAIN_MAX_URL_LENGTH
    ? TERRAIN_GRID_N
    : TERRAIN_GRID_N_SMALL;
}

/** Reads a `getSamples` answer into a grid. Each sample is matched to its
 *  point by `locationId`; a missing sample or a value that is not a ground
 *  elevation ("NoData", a sentinel) is unknown. Null when the body is not a
 *  samples answer at all. */
export function parseTerrainSamples(text: string, box: SearchBox, n: number): TerrainGrid | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const samples = (body as { samples?: unknown }).samples;
  if (!Array.isArray(samples)) return null;
  const elevM: Array<number | null> = new Array<number | null>(n * n).fill(null);
  const resolutions: number[] = [];
  for (const s of samples) {
    if (!s || typeof s !== 'object') continue;
    const row = s as { locationId?: unknown; value?: unknown; resolution?: unknown };
    const id = row.locationId;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= n * n) continue;
    const raw =
      typeof row.value === 'string' && row.value.trim() !== '' ? Number(row.value) : row.value;
    const z = validElevationM(raw);
    if (z === null) continue;
    elevM[id] = z;
    if (typeof row.resolution === 'number' && Number.isFinite(row.resolution) && row.resolution > 0)
      resolutions.push(row.resolution);
  }
  return {
    box,
    n,
    elevM,
    // The coarsest cell any point came from: the honest figure for the grid.
    resolutionM: resolutions.length ? Math.round(Math.max(...resolutions) * 100) / 100 : null
  };
}

function knownPoints(grid: TerrainGrid): number {
  return grid.elevM.filter((v) => v !== null).length;
}

/** One request, host-pinned (no redirects), capped and timed out. Never
 *  throws. */
export async function fetchTerrainGrid(
  box: SearchBox,
  fetcher: TerrainFetcher = safeFetch
): Promise<TerrainLookup> {
  if (!validBox(box)) return { status: 'unavailable' };
  const sampled = terrainBox(box);
  if (!validBox(sampled)) return { status: 'unavailable' };
  try {
    const n = terrainGridSize(sampled);
    const res = await fetcher(terrainUrl(sampled, n), {
      timeoutMs: TERRAIN_TIMEOUT_MS,
      maxBytes: TERRAIN_MAX_BYTES,
      maxRedirects: 0,
      headers: { accept: 'application/json' }
    });
    if (res.status !== 200 || new URL(res.url).hostname !== TERRAIN_HOST) {
      res.cancel();
      return { status: 'unavailable' };
    }
    const { text, truncated } = await res.readText();
    if (truncated) return { status: 'unavailable' };
    const grid = parseTerrainSamples(text, sampled, n);
    if (!grid) return { status: 'unavailable' };
    return knownPoints(grid) >= TERRAIN_MIN_KNOWN_POINTS
      ? { status: 'ok', grid }
      : { status: 'no-data' };
  } catch {
    return { status: 'unavailable' };
  }
}

function validGrid(v: unknown): v is TerrainGrid {
  if (!v || typeof v !== 'object') return false;
  const g = v as Partial<TerrainGrid>;
  return (
    typeof g.n === 'number' &&
    Number.isInteger(g.n) &&
    g.n >= 2 &&
    g.n <= TERRAIN_GRID_N &&
    Array.isArray(g.elevM) &&
    g.elevM.length === g.n * g.n &&
    g.elevM.every((z) => z === null || validElevationM(z) !== null) &&
    !!g.box &&
    validBox(g.box) &&
    (g.resolutionM === null || (typeof g.resolutionM === 'number' && g.resolutionM > 0))
  );
}

function readCache(key: string, now: number): TerrainLookup | null {
  const row = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!row || row.expiresAt.getTime() <= now) return null;
  try {
    const lookup = (JSON.parse(row.payloadJson) as { lookup?: TerrainLookup })?.lookup;
    if (lookup?.status === 'no-data' || lookup?.status === 'unavailable') {
      return { status: lookup.status };
    }
    if (lookup?.status === 'ok' && validGrid(lookup.grid)) return lookup;
    return null;
  } catch {
    return null;
  }
}

function writeCache(key: string, now: number, lookup: TerrainLookup): void {
  const ttl = lookup.status === 'unavailable' ? TERRAIN_UNAVAILABLE_TTL_MS : TERRAIN_TTL_MS;
  const expiresAt = new Date(now + ttl);
  const payloadJson = JSON.stringify({ lookup, source: 'usgs-3dep-getsamples' });
  db.insert(weatherForecastCache)
    .values({ id: randomUUID(), cacheKey: key, fetchedAt: new Date(now), expiresAt, payloadJson })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { fetchedAt: new Date(now), expiresAt, payloadJson }
    })
    .run();
}

/** A clean tilted plane is served only on a dev-routes server that asked
 *  for it (the main e2e preview server), never in production. */
export function terrainFixtureEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.E2E_TERRAIN_FIXTURE === '1' && env.ENABLE_DEV_ROUTES === '1';
}

/** The fixture's ground for any box: one even slope, the same everywhere. */
export function fixtureTerrainGrid(box: SearchBox): TerrainGrid {
  const sampled = terrainBox(box);
  const n = TERRAIN_GRID_N;
  const frame = localFrame(boxCenter(sampled));
  const az = (TERRAIN_FIXTURE_ASPECT_DEG * Math.PI) / 180;
  const rise = TERRAIN_FIXTURE_SLOPE_PCT / 100;
  const elevM = gridPoints(sampled, n).map(([lon, lat]) => {
    const x = (lon - frame.lon0) * frame.mPerDegLon;
    const y = (lat - frame.lat0) * METERS_PER_DEG_LAT;
    // The ground falls toward the bearing it faces.
    return Math.round((120 - rise * (x * Math.sin(az) + y * Math.cos(az))) * 1000) / 1000;
  });
  return { box: sampled, n, elevM, resolutionM: TERRAIN_FIXTURE_RESOLUTION_M };
}

const inFlight = new Map<string, Promise<TerrainLookup>>();

/** The elevation grid for a search box, cached in the global location-keyed
 *  weather cache: 180 days for an answer or "no data", a few minutes when
 *  the service could not be reached. Honours `WEATHER_FEEDS=off`. Never
 *  throws. */
export function terrainGridFor(
  box: SearchBox,
  opts: { fetcher?: TerrainFetcher; now?: number } = {}
): Promise<TerrainLookup> {
  if (!validBox(box)) return Promise.resolve({ status: 'unavailable' });
  const sampled = terrainBox(box);
  if (!validBox(sampled)) return Promise.resolve({ status: 'unavailable' });
  if (terrainFixtureEnabled()) {
    return Promise.resolve({ status: 'ok', grid: fixtureTerrainGrid(sampled) });
  }
  const now = opts.now ?? realNow();
  let key: string;
  try {
    key = terrainCacheKey(sampled, terrainGridSize(sampled));
    const cached = readCache(key, now);
    if (cached) return Promise.resolve(cached);
  } catch {
    return Promise.resolve({ status: 'unavailable' });
  }
  if (weatherFeedsOff()) return Promise.resolve({ status: 'unavailable' });
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = fetchTerrainGrid(sampled, opts.fetcher)
    .then((lookup) => {
      try {
        writeCache(key, now, lookup);
      } catch {
        /* the answer still stands without the cache */
      }
      return lookup;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const WINDOW_MS = 60_000;
export const TERRAIN_PER_MINUTE = 20;
const hits = new Map<string, number[]>();

/** In-process sliding window (single replica, Invariant 3). */
export function allowTerrainLookup(userId: string, now = realNow()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= TERRAIN_PER_MINUTE) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return true;
}

export function resetTerrainRateLimit(): void {
  hits.clear();
}
