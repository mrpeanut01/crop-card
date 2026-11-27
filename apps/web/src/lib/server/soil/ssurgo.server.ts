import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { getField } from '$lib/db/fields';
import { weatherForecastCache } from '$lib/db/schema';
import { geojsonCentroid } from '$lib/geo/area';
import { savedFarmLatLon } from '$lib/schedule/settings';
import { realNow } from '$lib/server/clock';
import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from '$lib/server/safeFetch';
import { weatherFeedsOff } from '$lib/server/weather';
import { soilLookupSchema } from '$lib/soil/apiSchemas';
import { isEmptySdaAnswer, parseSdaTable } from '$lib/soil/parse';
import type { SoilAreaLookup, SoilLookup } from '$lib/soil/types';
import loudounFixture from '$lib/server/__fixtures__/sda-loudoun.json';

/**
 * USDA NRCS soil survey (SSURGO) for a point, through Soil Data Access
 * (public, no key). Reference data only: the result is shown to the farmer
 * and never read by the safety kernel, the Inputs Plan or fertility math.
 * A failure is "unavailable", never an error.
 */

export const SDA_HOST = 'sdmdataaccess.sc.egov.usda.gov';
export const SDA_URL = `https://${SDA_HOST}/Tabular/post.rest`;
export const SOIL_TIMEOUT_MS = 8_000;
export const SOIL_MAX_BYTES = 262_144;
export const SOIL_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const SOIL_UNAVAILABLE_TTL_MS = 3 * 60 * 1000;

export type SoilFetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResponse>;

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

const SDA_QUERY_HEAD =
  'SELECT mu.mukey, mu.musym, mu.muname, mu.farmlndcl, ma.drclassdcd, ma.slopegradwta, ' +
  'ma.wtdepannmin, ma.brockdepmin, ma.hydgrpdcd, ma.flodfreqdcd, ma.aws0100wta, c.cokey, ' +
  'c.compname, c.comppct_r, c.majcompflag, c.drainagecl, c.slope_r, c.hydricrating, c.taxorder, ' +
  'ch.hzname, ch.hzdept_r, ch.hzdepb_r, ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r, ch.om_r, ' +
  'ch.ph1to1h2o_l, ch.ph1to1h2o_r, ch.ph1to1h2o_h, ' +
  "(SELECT TOP 1 tg.texdesc FROM chtexturegrp tg WHERE tg.chkey = ch.chkey AND tg.rvindicator = 'Yes') AS texdesc " +
  'FROM mapunit mu INNER JOIN muaggatt ma ON ma.mukey = mu.mukey ' +
  "LEFT JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' " +
  'LEFT JOIN chorizon ch ON ch.cokey = c.cokey AND ch.hzdept_r = ' +
  "(SELECT MIN(h2.hzdept_r) FROM chorizon h2 WHERE h2.cokey = c.cokey AND h2.hzname NOT LIKE 'O%') " +
  'WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84(';
const SDA_QUERY_TAIL = ')) ORDER BY c.comppct_r DESC, c.cokey';

/** The one query this module sends. The only variable parts are two numbers
 *  written with fixed decimals, so no caller text ever reaches the SQL. */
export function sdaQuery(lat: number, lon: number): string {
  if (!validPoint(lat, lon)) throw new RangeError('soil survey point out of range');
  return `${SDA_QUERY_HEAD}'point(${lon.toFixed(5)} ${lat.toFixed(5)})'${SDA_QUERY_TAIL}`;
}

/** One Soil Data Access request, host-pinned (no redirects), capped and
 *  timed out. Never throws. */
export async function fetchSoilSurvey(
  lat: number,
  lon: number,
  fetcher: SoilFetcher = safeFetch,
  now: number = realNow()
): Promise<SoilLookup> {
  if (!validPoint(lat, lon)) return { status: 'no-data' };
  try {
    const res = await fetcher(SDA_URL, {
      method: 'POST',
      body: JSON.stringify({ format: 'JSON+COLUMNNAME', query: sdaQuery(lat, lon) }),
      timeoutMs: SOIL_TIMEOUT_MS,
      maxBytes: SOIL_MAX_BYTES,
      maxRedirects: 0,
      headers: { accept: 'application/json', 'content-type': 'application/json' }
    });
    if (res.status !== 200 || new URL(res.url).hostname !== SDA_HOST) {
      res.cancel();
      return { status: 'unavailable' };
    }
    const { text, truncated } = await res.readText();
    if (truncated) return { status: 'unavailable' };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: 'unavailable' };
    }
    if (isEmptySdaAnswer(body)) return { status: 'no-data' };
    const survey = parseSdaTable(body, now);
    return survey ? { status: 'ok', survey } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

export function soilCacheKey(lat: number, lon: number): string {
  return `soil:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function readCache(key: string, now: number): SoilLookup | null {
  const row = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!row || row.expiresAt.getTime() <= now) return null;
  try {
    const parsed = soilLookupSchema.safeParse(
      (JSON.parse(row.payloadJson) as { lookup?: unknown })?.lookup
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, now: number, lookup: SoilLookup): void {
  const ttl = lookup.status === 'unavailable' ? SOIL_UNAVAILABLE_TTL_MS : SOIL_TTL_MS;
  const expiresAt = new Date(now + ttl);
  const payloadJson = JSON.stringify({ lookup, source: 'usda-nrcs-sda' });
  db.insert(weatherForecastCache)
    .values({ id: randomUUID(), cacheKey: key, fetchedAt: new Date(now), expiresAt, payloadJson })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { fetchedAt: new Date(now), expiresAt, payloadJson }
    })
    .run();
}

/** The recorded Loudoun answer is served only on a dev-routes server that
 *  asked for it (the main e2e preview server), never in production. */
export function soilFixtureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.E2E_SOIL_FIXTURE === '1' && env.ENABLE_DEV_ROUTES === '1';
}

const inFlight = new Map<string, Promise<SoilLookup>>();

/** The soil survey at a point, cached in the global location-keyed weather
 *  cache: 180 days for an answer or "no data", a few minutes when the
 *  service could not be reached. Never throws. */
export function soilSurveyAt(
  lat: number,
  lon: number,
  opts: { fetcher?: SoilFetcher; now?: number } = {}
): Promise<SoilLookup> {
  if (!validPoint(lat, lon)) return Promise.resolve({ status: 'no-data' });
  const now = opts.now ?? realNow();
  if (soilFixtureEnabled()) {
    const survey = parseSdaTable(loudounFixture, now);
    return Promise.resolve(survey ? { status: 'ok', survey } : { status: 'unavailable' });
  }
  const key = soilCacheKey(lat, lon);
  const cached = readCache(key, now);
  if (cached) return Promise.resolve(cached);
  if (weatherFeedsOff()) return Promise.resolve({ status: 'unavailable' });
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = fetchSoilSurvey(lat, lon, opts.fetcher, now)
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
export const SOIL_PER_MINUTE = 20;
const hits = new Map<string, number[]>();

/** In-process sliding window (single replica, Invariant 3). */
export function allowSoilLookup(userId: string, now = realNow()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= SOIL_PER_MINUTE) {
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

export function resetSoilRateLimit(): void {
  hits.clear();
}

/**
 * The soil survey for one of the active Owner's Areas, at the centre of its
 * drawn outline. An Area that is not drawn uses the farm's saved location
 * and says `approximate: true`.
 *
 * Returns `undefined` when the Area does not exist for this Owner (another
 * Owner's id reads the same), and `null` when the Area is not drawn and the
 * farm has no saved location.
 */
export async function soilSurveyForArea(
  areaId: string,
  opts: { fetcher?: SoilFetcher; now?: number } = {}
): Promise<SoilAreaLookup | null | undefined> {
  const area = getField(areaId);
  if (!area) return undefined;
  const centre = geojsonCentroid(area.geometryGeojson);
  let point: { lat: number; lon: number } | null = null;
  let approximate = false;
  if (centre && validPoint(centre[1], centre[0])) point = { lat: centre[1], lon: centre[0] };
  else {
    const farm = savedFarmLatLon();
    if (farm && validPoint(farm.lat, farm.lon)) {
      point = { lat: farm.lat, lon: farm.lon };
      approximate = true;
    }
  }
  if (!point) return null;
  return { lookup: await soilSurveyAt(point.lat, point.lon, opts), approximate, ...point };
}
