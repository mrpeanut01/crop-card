/**
 * Observed (past) hourly weather for a location, from NOAA station records.
 *
 * - NCEI Global Historical Climatology Network hourly (GHCNh) through the NCEI
 *   Access Data Service: quality-controlled, public domain, ~1.5 days behind.
 *   Fetched per station and calendar month, cached in the global
 *   `weather_forecast_cache` under `observed:<ghcnId>:<YYYY-MM>`.
 * - NWS station observations (api.weather.gov, ~7 days retained) fill the gap
 *   between the last GHCNh hour and now. Cached 1 h under `observed-nws:<ICAO>`.
 *
 * The station is the nearest ICAO-bearing GHCNh site within
 * OBSERVED_MAX_STATION_MILES (bundled list `stations/ghcnh-stations-us.json`, `scripts/build-ghcnh-stations.mjs`).
 * Precipitation is left null: GHCNh "hourly" totals mix intermediate reports.
 * Values carry `data` provenance with the station name; no station, or a
 * failed feed, yields `fallback` with no hours. Server-only; never throws.
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { haversineFt } from '$lib/blocks/distance';
import { NWS_BASE, nwsFetch, USER_AGENT } from '$lib/server/weather';
import { safeFetch, type SafeFetchOptions } from '$lib/server/safeFetch';
import { floorHour, HOUR_MS, type HourlyPoint, type WeatherProvenance } from '$lib/weather/leafWet';
import stationData from './stations/ghcnh-stations-us.json';

export const NCEI_ADS_BASE = 'https://www.ncei.noaa.gov/access/services/data/v1';
export const OBSERVED_MAX_STATION_MILES = 30;
export const OBSERVED_MAX_SPAN_DAYS = 400;
export const NCEI_TIMEOUT_MS = 20_000;
export const NCEI_MAX_BYTES = 3_000_000;
export const NWS_OBS_TTL_MS = 60 * 60 * 1000;
export const OPEN_MONTH_TTL_MS = 6 * 60 * 60 * 1000;
export const CLOSED_MONTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** GHCNh is still revised for a while after a month ends. */
const MONTH_SETTLE_MS = 10 * 24 * 60 * 60 * 1000;
const NWS_OBS_WINDOW_MS = 7 * 24 * HOUR_MS;
const FT_PER_MILE = 5280;
const DAY_MS = 24 * HOUR_MS;

export type ObservedSource = 'ghcnh' | 'nws-obs';

export interface ObservedStation {
  ghcnId: string;
  icao: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
}

export interface ObservedWeather {
  hours: HourlyPoint[];
  provenance: WeatherProvenance;
  station: ObservedStation | null;
  sources: ObservedSource[];
  /** Last hour with an observation, ms epoch. */
  latestMs: number | null;
  error: string | null;
}

type StationRow = [string, string, number, number, string];
const STATIONS = (stationData as unknown as { stations: StationRow[] }).stations;

export function nearestObservedStations(
  lat: number,
  lon: number,
  limit = 3,
  maxMiles = OBSERVED_MAX_STATION_MILES
): ObservedStation[] {
  const out: ObservedStation[] = [];
  for (const [ghcnId, icao, sLat, sLon, name] of STATIONS) {
    if (Math.abs(sLat - lat) > 1 || Math.abs(sLon - lon) > 1.5) continue;
    const distanceMiles = haversineFt(lat, lon, sLat, sLon) / FT_PER_MILE;
    if (distanceMiles > maxMiles) continue;
    out.push({ ghcnId, icao, name, lat: sLat, lon: sLon, distanceMiles });
  }
  out.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return out.slice(0, limit).map((s) => ({
    ...s,
    distanceMiles: Math.round(s.distanceMiles * 10) / 10
  }));
}

/** "WASHINGTON DULLES INTL AP" → "Washington Dulles Intl AP (KIAD)". */
export function stationLabel(s: Pick<ObservedStation, 'name' | 'icao'>): string {
  const keepUpper = new Set(['AP', 'AFB', 'NAS']);
  const name = s.name
    .split(' ')
    .map((w) => (keepUpper.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
  return `${name} (${s.icao})`;
}

// ─── Parsing ───────────────────────────────────────────────────────────

export interface NceiRow {
  DATE?: string;
  temperature?: string;
  temperature_Quality_Code?: string;
  relative_humidity?: string;
  relative_humidity_Quality_Code?: string;
  dew_point_temperature?: string;
  dew_point_temperature_Quality_Code?: string;
}

/** GHCNh QC (docs §VI): legacy 2/3/6/7 are suspect/erroneous; lowercase letters name a failed check. */
export function passesGhcnhQc(code: string | undefined): boolean {
  if (!code) return true;
  if (/^[2367]$/.test(code)) return false;
  return !/^[a-z]$/.test(code);
}

const cToF = (c: number) => Math.round(((c * 9) / 5 + 32) * 10) / 10;

function num(raw: string | undefined, qc: string | undefined): number | null {
  if (raw === undefined || raw === '' || !passesGhcnhQc(qc)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > -9000 ? n : null;
}

interface Acc {
  t: number[];
  rh: number[];
  dp: number[];
}

/** Reports are bucketed to the nearest hour and averaged, matching the forecast grid's hour starts. */
function bucket(
  samples: Array<{ ms: number; tC: number | null; rh: number | null; dpC: number | null }>
) {
  const byT = new Map<number, Acc>();
  for (const s of samples) {
    if (s.tC === null && s.rh === null && s.dpC === null) continue;
    const t = floorHour(s.ms + HOUR_MS / 2);
    const a = byT.get(t) ?? { t: [], rh: [], dp: [] };
    if (s.tC !== null) a.t.push(s.tC);
    if (s.rh !== null) a.rh.push(s.rh);
    if (s.dpC !== null) a.dp.push(s.dpC);
    byT.set(t, a);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  return [...byT.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, a]): HourlyPoint => {
      const tC = mean(a.t);
      const dpC = mean(a.dp);
      const rh = mean(a.rh);
      return {
        t,
        tempF: tC === null ? null : cToF(tC),
        dewpointF: dpC === null ? null : cToF(dpC),
        rhPct: rh === null ? null : Math.round(Math.min(100, Math.max(0, rh)) * 10) / 10,
        popPct: null,
        precipMm: null,
        windMph: null
      };
    });
}

export function nceiRowsToHourly(rows: NceiRow[]): HourlyPoint[] {
  const samples = [];
  for (const r of rows) {
    if (!r.DATE) continue;
    const ms = Date.parse(`${r.DATE}Z`);
    if (Number.isNaN(ms)) continue;
    samples.push({
      ms,
      tC: num(r.temperature, r.temperature_Quality_Code),
      rh: num(r.relative_humidity, r.relative_humidity_Quality_Code),
      dpC: num(r.dew_point_temperature, r.dew_point_temperature_Quality_Code)
    });
  }
  return bucket(samples);
}

interface NwsQuantity {
  unitCode?: string;
  value: number | null;
  qualityControl?: string;
}

export interface NwsObservationsResponse {
  features?: Array<{
    properties?: {
      timestamp?: string;
      temperature?: NwsQuantity;
      dewpoint?: NwsQuantity;
      relativeHumidity?: NwsQuantity;
    };
  }>;
}

/** NWS QC: X = rejected, Q = questioned. */
function nwsValue(q: NwsQuantity | undefined): number | null {
  if (!q || typeof q.value !== 'number' || !Number.isFinite(q.value)) return null;
  if (q.qualityControl === 'X' || q.qualityControl === 'Q') return null;
  return q.value;
}

function nwsCelsius(q: NwsQuantity | undefined): number | null {
  const v = nwsValue(q);
  if (v === null) return null;
  return q?.unitCode && /degF/i.test(q.unitCode) ? ((v - 32) * 5) / 9 : v;
}

export function nwsObservationsToHourly(body: NwsObservationsResponse): HourlyPoint[] {
  const samples = [];
  for (const f of body.features ?? []) {
    const p = f.properties;
    const ms = p?.timestamp ? Date.parse(p.timestamp) : NaN;
    if (!p || Number.isNaN(ms)) continue;
    samples.push({
      ms,
      tC: nwsCelsius(p.temperature),
      rh: nwsValue(p.relativeHumidity),
      dpC: nwsCelsius(p.dewpoint)
    });
  }
  return bucket(samples);
}

// ─── Fetching ──────────────────────────────────────────────────────────

export class ObservedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservedFetchError';
  }
}

const NCEI_DATA_TYPES = [
  'DATE',
  'temperature',
  'temperature_Quality_Code',
  'relative_humidity',
  'relative_humidity_Quality_Code',
  'dew_point_temperature',
  'dew_point_temperature_Quality_Code'
].join(',');

const isoNoMs = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export function nceiUrl(ghcnId: string, startMs: number, endMs: number): string {
  const q = new URLSearchParams({
    dataset: 'global-historical-climatology-network-hourly',
    stations: ghcnId,
    startDate: isoNoMs(startMs),
    endDate: isoNoMs(endMs),
    dataTypes: NCEI_DATA_TYPES,
    format: 'json'
  });
  return `${NCEI_ADS_BASE}?${q.toString()}`;
}

export function isNceiAdsUrl(url: string): boolean {
  return url.startsWith(`${NCEI_ADS_BASE}?`);
}

export type FetchText = (url: string) => Promise<string>;

/** NCEI ADS GET through safeFetch: host pinned, no redirects, timeout + size cap. */
export function nceiFetchText(extra: SafeFetchOptions = {}): FetchText {
  return async (url) => {
    if (!isNceiAdsUrl(url)) throw new ObservedFetchError('Refusing non-NCEI URL');
    const res = await safeFetch(url, {
      timeoutMs: NCEI_TIMEOUT_MS,
      maxBytes: NCEI_MAX_BYTES,
      maxRedirects: 0,
      ...extra,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...extra.headers }
    });
    if (res.status !== 200) {
      res.cancel();
      throw new ObservedFetchError(`NCEI returned ${res.status}`);
    }
    const { text, truncated } = await res.readText();
    if (truncated) throw new ObservedFetchError('NCEI response exceeded the size cap');
    return text;
  };
}

export interface ObservedDeps {
  nceiText?: FetchText;
  nwsObservations?: (icao: string, startMs: number) => Promise<NwsObservationsResponse>;
}

function defaultNwsObservations(icao: string, startMs: number) {
  if (!/^[A-Z0-9]{4}$/.test(icao)) throw new ObservedFetchError('bad station id');
  const start = new Date(startMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return nwsFetch<NwsObservationsResponse>(
    `${NWS_BASE}/stations/${icao}/observations?start=${encodeURIComponent(start)}`
  );
}

// ─── Cache ─────────────────────────────────────────────────────────────

function readCache(key: string, now: number): HourlyPoint[] | null {
  const row = db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!row || row.expiresAt.getTime() <= now) return null;
  try {
    const hours = JSON.parse(row.payloadJson) as HourlyPoint[];
    return Array.isArray(hours) ? hours : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, now: number, ttlMs: number, hours: HourlyPoint[]): void {
  const expiresAt = new Date(now + ttlMs);
  const payloadJson = JSON.stringify(hours);
  db.insert(weatherForecastCache)
    .values({ id: randomUUID(), cacheKey: key, fetchedAt: new Date(now), expiresAt, payloadJson })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { fetchedAt: new Date(now), expiresAt, payloadJson }
    })
    .run();
}

export function observedMonthKey(ghcnId: string, monthStartMs: number): string {
  return `observed:${ghcnId}:${new Date(monthStartMs).toISOString().slice(0, 7)}`;
}

/** UTC calendar-month starts covering [fromMs, toMs). */
export function monthStarts(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  const d = new Date(fromMs);
  let m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  while (m < toMs) {
    out.push(m);
    const n = new Date(m);
    m = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
  }
  return out;
}

async function ghcnhMonth(
  station: ObservedStation,
  monthStart: number,
  now: number,
  fetchText: FetchText
): Promise<HourlyPoint[]> {
  const key = observedMonthKey(station.ghcnId, monthStart);
  const cached = readCache(key, now);
  if (cached) return cached;
  const next = new Date(monthStart);
  const monthEnd = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  const text = await fetchText(nceiUrl(station.ghcnId, monthStart, Math.min(monthEnd, now)));
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new ObservedFetchError('NCEI response was not JSON');
  }
  if (!Array.isArray(rows)) throw new ObservedFetchError('NCEI response was not a row array');
  const hours = nceiRowsToHourly(rows as NceiRow[]).filter(
    (h) => h.t >= monthStart && h.t < monthEnd && h.t <= now
  );
  const ttl = monthEnd + MONTH_SETTLE_MS <= now ? CLOSED_MONTH_TTL_MS : OPEN_MONTH_TTL_MS;
  writeCache(key, now, ttl, hours);
  return hours;
}

async function nwsRecent(
  station: ObservedStation,
  startMs: number,
  now: number,
  deps: ObservedDeps
): Promise<HourlyPoint[]> {
  const key = `observed-nws:${station.icao}`;
  const cached = readCache(key, now);
  if (cached) return cached.filter((h) => h.t >= startMs);
  const fetchObs = deps.nwsObservations ?? defaultNwsObservations;
  const body = await fetchObs(station.icao, now - NWS_OBS_WINDOW_MS);
  const hours = nwsObservationsToHourly(body).filter((h) => h.t <= now);
  writeCache(key, now, NWS_OBS_TTL_MS, hours);
  return hours.filter((h) => h.t >= startMs);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function empty(error: string | null, station: ObservedStation | null = null): ObservedWeather {
  return { hours: [], provenance: 'fallback', station, sources: [], latestMs: null, error };
}

/**
 * Observed hours in [fromMs, now]. Tries up to three nearest stations and keeps
 * the first that returns any hours; stops early when both feeds error. Never throws.
 */
export async function getObservedHours(
  lat: number,
  lon: number,
  fromMs: number,
  now: number = Date.now(),
  deps: ObservedDeps = {}
): Promise<ObservedWeather> {
  const start = floorHour(Math.max(fromMs, now - OBSERVED_MAX_SPAN_DAYS * DAY_MS));
  if (start >= now) return empty(null);
  const stations = nearestObservedStations(lat, lon);
  if (stations.length === 0) {
    return empty(`No NOAA hourly station within ${OBSERVED_MAX_STATION_MILES} miles`);
  }
  const fetchText = deps.nceiText ?? nceiFetchText();
  let lastError: string | null = null;
  for (const station of stations) {
    const byT = new Map<number, HourlyPoint>();
    const sources: ObservedSource[] = [];
    let failures = 0;
    try {
      const months = await mapLimit(monthStarts(start, now), 2, (m) =>
        ghcnhMonth(station, m, now, fetchText)
      );
      for (const h of months.flat()) if (h.t >= start) byT.set(h.t, h);
      if (byT.size > 0) sources.push('ghcnh');
    } catch (e) {
      failures++;
      lastError = e instanceof Error ? e.message : String(e);
    }
    const lastGhcnh = byT.size > 0 ? Math.max(...byT.keys()) : start - HOUR_MS;
    if (now - lastGhcnh > HOUR_MS) {
      try {
        const recent = await nwsRecent(station, Math.max(start, lastGhcnh + HOUR_MS), now, deps);
        let added = 0;
        for (const h of recent) {
          if (!byT.has(h.t)) {
            byT.set(h.t, h);
            added++;
          }
        }
        if (added > 0) sources.push('nws-obs');
      } catch (e) {
        failures++;
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    // Both feeds down is an outage, not a quiet station: the next one would fail the same way.
    if (byT.size === 0 && failures === 2) break;
    if (byT.size === 0) continue;
    const hours = [...byT.values()].sort((a, b) => a.t - b.t);
    return {
      hours,
      provenance: 'data',
      station,
      sources,
      latestMs: hours[hours.length - 1].t,
      error: null
    };
  }
  return empty(lastError ?? 'No observations returned', stations[0]);
}
