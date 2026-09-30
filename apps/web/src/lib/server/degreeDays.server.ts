/**
 * Degree days for the farm's pest models (Phase 32E, GW-8 to GW-10).
 *
 * Daily TMAX and TMIN come from GHCN-Daily (`daily-summaries` through the NCEI
 * Access Data Service) for the nearest bundled `USW` station within 30 miles;
 * a `USW` station's GHCNh id is its GHCN-Daily id. Rows are cached globally in
 * `weather_forecast_cache` under `gdd-daily:<ghcnId>:<year>`. Gaps are never
 * filled and no other station is borrowed: a total with gaps is a lower bound.
 * Totals are computed per request because the biofix is per Owner.
 *
 * Nothing here touches `lib/safety` or IPM threshold state. Server-only.
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { listCrops } from '$lib/db/crops';
import { listBiofixes } from '$lib/db/pestBiofix';
import { accumulate, isYmd, type DailyTemps } from '$lib/climate/degreeDays';
import {
  acceptsManualBiofix,
  modelApplies,
  modelStatus,
  resolveBiofix,
  showOnScout,
  showOnToday,
  shortDay,
  watchForLines,
  type StoredBiofix
} from '$lib/ipm/pestModels';
import type { PestModelPlugin } from '$lib/plugins/schemas';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { farmTimeZone } from '$lib/db/userProfile';
import { DEFAULT_PREFS, ymdInZone } from '$lib/prefs';
import { getDataKinds, getRegistry } from '$lib/server/registry';
import {
  CLOSED_MONTH_TTL_MS,
  NCEI_ADS_BASE,
  nceiFetchText,
  nearestObservedStations,
  OBSERVED_MAX_STATION_MILES,
  OPEN_MONTH_TTL_MS,
  stationLabel,
  type FetchText,
  type ObservedStation
} from '$lib/server/weatherObserved';
import type { TodayAdviceCard, TodayAdviceProvider } from '$lib/today/advice';
import { degreeDayFixtureEnabled } from '$lib/ipm/pestModel.fixtures';
import type {
  DegreeDayModelResult,
  DegreeDaysResult,
  DegreeDayStation
} from '$lib/ipm/degreeDayResult';

export type {
  DegreeDayLocation,
  DegreeDayModelResult,
  DegreeDaysResult,
  DegreeDayStation
} from '$lib/ipm/degreeDayResult';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A failed fetch is remembered briefly so a cold outage does not stall every page. */
export const FAILED_FETCH_TTL_MS = 15 * 60 * 1000;
/** GHCN-Daily is still revised for a while after the year ends. */
const YEAR_SETTLE_MS = 10 * DAY_MS;
/** /today gets a shorter budget than the route and /scout. */
export const TODAY_FETCH_TIMEOUT_MS = 5_000;
/** /scout streams the strip, so it can wait a little longer. */
export const SCOUT_FETCH_TIMEOUT_MS = 10_000;

// ─── NCEI daily summaries ──────────────────────────────────────────────

export function nceiDailyUrl(ghcnId: string, startYmd: string, endYmd: string): string {
  const q = new URLSearchParams({
    dataset: 'daily-summaries',
    stations: ghcnId,
    startDate: startYmd,
    endDate: endYmd,
    dataTypes: 'TMAX,TMIN',
    units: 'standard',
    includeAttributes: 'true',
    format: 'json'
  });
  return `${NCEI_ADS_BASE}?${q.toString()}`;
}

export interface NceiDailyRow {
  DATE?: string;
  TMAX?: string | number;
  TMIN?: string | number;
  TMAX_ATTRIBUTES?: string;
  TMIN_ATTRIBUTES?: string;
}

/** GHCN-Daily attributes are "MFLAG,QFLAG,SFLAG,TIME"; any QFLAG means the value failed a check. */
export function passesGhcndQc(attributes: string | undefined): boolean {
  if (!attributes) return true;
  const qflag = attributes.split(',')[1] ?? '';
  return qflag.trim() === '';
}

function dailyValue(raw: string | number | undefined, attrs: string | undefined): number | null {
  if (raw === undefined || raw === null || !passesGhcndQc(attrs)) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > -200 && n < 200 ? n : null;
}

export function parseDailyRows(rows: NceiDailyRow[]): DailyTemps[] {
  const byDay = new Map<string, DailyTemps>();
  for (const r of rows) {
    const ymd = typeof r.DATE === 'string' ? r.DATE.slice(0, 10) : '';
    if (!isYmd(ymd)) continue;
    byDay.set(ymd, {
      ymd,
      tmaxF: dailyValue(r.TMAX, r.TMAX_ATTRIBUTES),
      tminF: dailyValue(r.TMIN, r.TMIN_ATTRIBUTES)
    });
  }
  return [...byDay.values()].sort((a, b) => a.ymd.localeCompare(b.ymd));
}

/** `USW` stations within 30 miles, nearest first. */
export function degreeDayStations(lat: number, lon: number): ObservedStation[] {
  return nearestObservedStations(lat, lon, 50, OBSERVED_MAX_STATION_MILES)
    .filter((s) => s.ghcnId.startsWith('USW'))
    .slice(0, 3);
}

export function gddDailyKey(ghcnId: string, year: number): string {
  return `gdd-daily:${ghcnId}:${year}`;
}

type CachePayload = { days: DailyTemps[] } | { error: string };

function readCache(key: string, now: number): CachePayload | null {
  unscopedQueryNote('global weather cache');
  const row = db
    .select({
      payloadJson: weatherForecastCache.payloadJson,
      expiresAt: weatherForecastCache.expiresAt
    })
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, key))
    .get();
  if (!row || row.expiresAt.getTime() <= now) return null;
  try {
    const v = JSON.parse(row.payloadJson) as CachePayload;
    if ('days' in v && Array.isArray(v.days)) return v;
    if ('error' in v && typeof v.error === 'string') return v;
  } catch {
    /* a bad row is a miss */
  }
  return null;
}

function writeCache(key: string, now: number, ttlMs: number, payload: CachePayload): void {
  unscopedQueryNote('global weather cache');
  const expiresAt = new Date(now + ttlMs);
  const payloadJson = JSON.stringify(payload);
  db.insert(weatherForecastCache)
    .values({ id: randomUUID(), cacheKey: key, fetchedAt: new Date(now), expiresAt, payloadJson })
    .onConflictDoUpdate({
      target: weatherForecastCache.cacheKey,
      set: { fetchedAt: new Date(now), expiresAt, payloadJson }
    })
    .run();
}

export interface DegreeDayDeps {
  fetchText?: FetchText;
  timeoutMs?: number;
}

/** Synthetic rows for the e2e preview server only (`E2E_DEGREE_DAY_FIXTURE=1`):
 *  85/65 °F every day, published up to two days ago. Never real weather. */
function e2eFixtureFetch(now: number): FetchText {
  return async (url) => {
    const q = new URL(url).searchParams;
    const start = q.get('startDate') ?? '';
    const end = q.get('endDate') ?? '';
    const lastPublished = new Date(now - 2 * DAY_MS).toISOString().slice(0, 10);
    const rows: NceiDailyRow[] = [];
    for (let d = new Date(`${start}T00:00:00Z`); ; d = new Date(d.getTime() + DAY_MS)) {
      const ymd = d.toISOString().slice(0, 10);
      if (ymd > end || ymd > lastPublished) break;
      rows.push({
        DATE: ymd,
        STATION: q.get('stations') ?? '',
        TMAX: '85',
        TMIN: '65'
      } as NceiDailyRow);
    }
    return JSON.stringify(rows);
  };
}

function useE2eFixture(): boolean {
  return degreeDayFixtureEnabled(process.env);
}

/** A station's daily rows for a year, from the cache or one NCEI request. Never throws. */
export async function getDailyTemps(
  station: Pick<ObservedStation, 'ghcnId'>,
  year: number,
  now: number,
  deps: DegreeDayDeps = {}
): Promise<{ days: DailyTemps[]; error: string | null }> {
  const key = gddDailyKey(station.ghcnId, year);
  const cached = readCache(key, now);
  if (cached)
    return 'days' in cached
      ? { days: cached.days, error: null }
      : { days: [], error: cached.error };

  const start = `${year}-01-01`;
  const yearEndMs = Date.UTC(year + 1, 0, 1);
  const end = new Date(Math.min(now, yearEndMs - DAY_MS)).toISOString().slice(0, 10);
  if (end < start) return { days: [], error: null };
  const fetchText =
    deps.fetchText ??
    (useE2eFixture()
      ? e2eFixtureFetch(now)
      : nceiFetchText(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}));
  try {
    const text = await fetchText(nceiDailyUrl(station.ghcnId, start, end));
    const rows = JSON.parse(text) as unknown;
    if (!Array.isArray(rows)) throw new Error('NCEI response was not a row array');
    const days = parseDailyRows(rows as NceiDailyRow[]);
    const ttl = yearEndMs + YEAR_SETTLE_MS <= now ? CLOSED_MONTH_TTL_MS : OPEN_MONTH_TTL_MS;
    writeCache(key, now, ttl, { days });
    return { days, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    writeCache(key, now, FAILED_FETCH_TTL_MS, { error });
    return { days: [], error };
  }
}

// ─── Models ────────────────────────────────────────────────────────────

/** The calendar day at the farm, in the farm's saved time zone. */
export function farmYmd(nowMs: number, timeZone: string): string {
  return ymdInZone(nowMs, timeZone);
}

function lastCountableYmd(year: number, todayYmd: string): string {
  const yearEnd = `${year}-12-31`;
  return todayYmd < yearEnd ? todayYmd : yearEnd;
}

export function evaluateModel(
  model: PestModelPlugin,
  year: number,
  todayYmd: string,
  stored: StoredBiofix | null,
  days: readonly DailyTemps[] | null,
  applicable: boolean
): DegreeDayModelResult {
  const biofix = resolveBiofix(model, year, stored);
  const toYmd = lastCountableYmd(year, todayYmd);
  const acc =
    biofix.ymd !== null && days !== null && biofix.ymd <= toYmd
      ? accumulate(days, biofix.ymd, {
          method: model.method,
          baseF: model.baseTempF,
          upperCutoffF: model.upperCutoffF,
          toYmd
        })
      : null;
  const status = modelStatus(model, acc, biofix, toYmd);
  return {
    modelId: model.pluginId,
    displayName: model.displayName,
    pest: { commonName: model.pest.commonName, scientificName: model.pest.scientificName ?? null },
    hostCropFamilies: [...model.hostCropFamilies],
    method: model.method,
    baseTempF: model.baseTempF,
    upperCutoffF: model.upperCutoffF ?? null,
    biofix: {
      kind: biofix.kind,
      date: biofix.ymd,
      provenance: biofix.provenance,
      recordedBy: biofix.recordedBy,
      acceptsManual: acceptsManualBiofix(model)
    },
    totalLowerBound: Math.floor(status.total),
    missingDays: status.missingDays,
    throughYmd: status.throughYmd,
    status: {
      state: status.state,
      stage: status.stage,
      inWindow: status.inWindow,
      reached: status.reached,
      next: status.next
        ? {
            key: status.next.stage.key,
            label: status.next.stage.label,
            gddFrom: status.next.stage.gddFrom,
            remaining: status.next.remaining,
            uncertain: status.next.uncertain
          }
        : null
    },
    lines: watchForLines(status, biofix),
    applicable,
    showOnScout: applicable && showOnScout(status),
    showOnToday: applicable && showOnToday(status)
  };
}

function toStation(s: ObservedStation): DegreeDayStation {
  return { ghcnId: s.ghcnId, icao: s.icao, label: stationLabel(s), distanceMiles: s.distanceMiles };
}

/** "Washington Dulles Intl AP (KIAD), 6 mi" */
export function stationLine(s: DegreeDayStation): string {
  return `${s.label}, ${Math.round(s.distanceMiles)} mi`;
}

async function stationDays(
  lat: number,
  lon: number,
  year: number,
  now: number,
  deps: DegreeDayDeps
): Promise<{ station: ObservedStation | null; days: DailyTemps[] | null; error: string | null }> {
  const stations = degreeDayStations(lat, lon);
  if (stations.length === 0) return { station: null, days: null, error: null };
  let lastError: string | null = null;
  for (const s of stations) {
    const { days, error } = await getDailyTemps(s, year, now, deps);
    if (days.length > 0) return { station: s, days, error: null };
    lastError = error;
    // An outage, not a quiet station: the next one would fail the same way.
    if (error) break;
  }
  return { station: stations[0], days: null, error: lastError };
}

interface LoadInput {
  /** Defaults to the farm's current year. */
  year?: number;
  modelId?: string;
  nowMs?: number;
  farmLatLon?: { lat: number; lon: number } | null;
  plantedFamilies?: ReadonlySet<string>;
  /** The farm's time zone; read from settings when omitted. */
  timeZone?: string;
  deps?: DegreeDayDeps;
}

/** Crop families with an active or planned planting in `year`. */
export async function plantedFamiliesForYear(year: number, nowMs: number): Promise<Set<string>> {
  const registry = await getRegistry();
  const currentYear = new Date(nowMs).getFullYear();
  const out = new Set<string>();
  for (const c of listCrops({ statuses: ['active', 'planned', 'harvested'] })) {
    const y = c.plantingDate ? new Date(c.plantingDate).getFullYear() : null;
    const counts = y === year || (y === null && year === currentYear && c.status !== 'harvested');
    if (!counts) continue;
    const fam = registry.cropFamilyOf(c.cropPluginId);
    if (fam) out.add(fam);
  }
  return out;
}

/** Degree days for every pest model (or one), for the route and /scout. Runs in a tenant context. */
export async function loadDegreeDays(input: LoadInput): Promise<DegreeDaysResult> {
  const now = input.nowMs ?? Date.now();
  const all = (await getDataKinds()).pestModels.all();
  const models = input.modelId ? all.filter((m) => m.pluginId === input.modelId) : all;
  if (models.length === 0) {
    return {
      year: input.year ?? new Date(now).getFullYear(),
      location: 'ok',
      message: null,
      station: null,
      dataError: null,
      models: []
    };
  }
  const todayYmd = farmYmd(now, input.timeZone ?? farmTimeZone());
  const year = input.year ?? Number(todayYmd.slice(0, 4));
  const base: DegreeDaysResult = {
    year,
    location: 'ok',
    message: null,
    station: null,
    dataError: null,
    models: []
  };

  const farm =
    input.farmLatLon !== undefined ? input.farmLatLon : hasFarmLatLon() ? getFarmLatLon() : null;
  const families = input.plantedFamilies ?? (await plantedFamiliesForYear(year, now));
  const biofixes = listBiofixes(year);
  const evaluate = (days: DailyTemps[] | null) =>
    models.map((m) =>
      evaluateModel(
        m,
        year,
        todayYmd,
        biofixes.get(m.pluginId) ?? null,
        days,
        modelApplies(m, families)
      )
    );

  if (!farm) {
    return {
      ...base,
      location: 'no-location',
      message: 'Set your farm location.',
      models: evaluate(null).map(hideCounts)
    };
  }
  const { station, days, error } = await stationDays(
    farm.lat,
    farm.lon,
    year,
    now,
    input.deps ?? {}
  );
  if (!station) {
    return {
      ...base,
      location: 'no-station',
      message: `Degree days need a weather station within ${OBSERVED_MAX_STATION_MILES} miles. None found.`,
      models: evaluate(null).map(hideCounts)
    };
  }
  return {
    ...base,
    station: toStation(station),
    dataError: error,
    message: days === null ? 'Station readings are not available right now.' : null,
    models: evaluate(days)
  };
}

/** Without a station there is no count; keep only the trap prompt. */
function hideCounts(r: DegreeDayModelResult): DegreeDayModelResult {
  const trapOnly = r.status.state === 'no-biofix';
  return {
    ...r,
    lines: trapOnly ? r.lines : [],
    showOnScout: r.applicable,
    showOnToday: false
  };
}

// ─── /today card ───────────────────────────────────────────────────────

export function biofixDetail(r: DegreeDayModelResult): string {
  if (!r.biofix.date) return 'No first catch recorded';
  const day = shortDay(r.biofix.date);
  if (r.biofix.provenance === 'manual') return `Counting from your first trap catch on ${day}`;
  if (r.biofix.provenance === 'fallback') return `Counting from ${day}, the model's usual start`;
  return `Counting from ${day}`;
}

export function degreeDayCards(result: DegreeDaysResult): TodayAdviceCard[] {
  if (!result.station) return [];
  return result.models
    .filter((m) => m.showOnToday)
    .map((m, i) => ({
      id: `pest:${m.modelId}`,
      kind: 'degree-days' as const,
      title: `Watch for ${m.pest.commonName.toLowerCase()}`,
      lines: m.lines,
      provenance:
        m.biofix.provenance === 'manual'
          ? ('manual' as const)
          : m.biofix.provenance === 'fallback'
            ? ('fallback' as const)
            : ('data' as const),
      detail: `${stationLine(result.station as DegreeDayStation)}. ${biofixDetail(m)}. Base ${m.baseTempF}°F.`,
      tone: 'wheat' as const,
      actions: [{ kind: 'link' as const, label: 'Open scouting', href: '/scout' }],
      sortKey: 200 + i
    }));
}

/** /today provider: no card unless a model's host crop is planted and a stage window is active.
 *  At most two queries (the biofix settings and the weather cache). */
export const degreeDayAdvice: TodayAdviceProvider = async (ctx) => {
  if (!ctx.farmLatLon) return [];
  const all = (await getDataKinds()).pestModels.all();
  const families = new Set(
    ctx.plantings.map((p) => p.cropFamily).filter((f): f is string => typeof f === 'string')
  );
  if (!all.some((m) => modelApplies(m, families))) return [];
  const result = await loadDegreeDays({
    year: ctx.seasonYear,
    nowMs: ctx.nowMs,
    farmLatLon: ctx.farmLatLon,
    plantedFamilies: families,
    timeZone: ctx.timeZone ?? DEFAULT_PREFS.timeZone,
    deps: { timeoutMs: TODAY_FETCH_TIMEOUT_MS }
  });
  return degreeDayCards(result);
};
