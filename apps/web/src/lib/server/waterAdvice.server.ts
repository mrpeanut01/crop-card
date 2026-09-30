/**
 * Watering advice for /today (Phase 32E, E4). Server-only.
 *
 * Query budget (E0-11): on a warm cache the provider makes at most four
 * database reads for every Area together: beds with their Areas, covers and
 * water targets (one joined read), watering logs, gauge readings, and the
 * global weather cache rows. A cold cache goes through the existing cached
 * getters, and a failed fetch reads as unknown rain, never an error.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  appSettings,
  blockProtections,
  blocks,
  fields,
  irrigationEvents,
  rainGaugeReadings,
  weatherForecastCache
} from '$lib/db/schema';
import { unscopedQueryNote, withTenant } from '$lib/db/tenant';
import { effectiveAcresFor, geometryCentroid } from '$lib/db/blocks';
import { storedSketchAcres } from '$lib/farm/sketch';
import { haversineFt } from '$lib/blocks/distance';
import {
  isActiveAt,
  shedsRain,
  type BlockProtection,
  type ProtectionKind
} from '$lib/climate/protection';
import {
  getObservedRain,
  nearestObservedStations,
  observedRainKey,
  stationLabel,
  type ObservedDeps,
  type ObservedStation
} from '$lib/server/weatherObserved';
import { getHourlyForecastSafely, hourlyCacheKey } from '$lib/server/weatherHourly';
import type { HourlyPoint } from '$lib/weather/leafWet';
import { HOUR_MS } from '$lib/weather/leafWet';
import type { RainHour } from '$lib/weather/metarRain';
import {
  GAUGE_LOOKBACK_MS,
  MAX_STATION_MILES,
  gaugePeriods,
  waterBalance,
  windowBounds,
  type BedInput,
  type StationRef,
  type WaterBalance,
  type WaterTarget
} from '$lib/weather/waterBalance';
import { wateringCard } from '$lib/weather/waterCopy';
import {
  DEFAULT_WEEKLY_TARGET_IN,
  WATER_TARGET_MAX_IN,
  WATER_TARGET_MIN_IN
} from '$lib/weather/waterSources';
import {
  isInGround,
  type TodayAdviceCard,
  type TodayAdviceContext,
  type TodayAdviceProvider
} from '$lib/today/advice';

const WATERED_AREA_KINDS = ['garden', 'field'] as const;
const SQFT_PER_ACRE = 43_560;
const FT_PER_MILE = 5280;
const TARGET_PREFIX = 'water_target_in_week.';

export interface WaterAdviceDeps extends ObservedDeps {
  /** Replaces the hourly forecast getter (tests). */
  forecast?: (lat: number, lon: number, now: number) => Promise<HourlyPoint[]>;
}

export interface AreaWaterInput {
  fieldId: string;
  name: string;
  kind: string;
  point: { lat: number; lon: number } | null;
  sqFt: number | null;
  target: WaterTarget | null;
  beds: BedInput[];
}

export function sqFtOf(row: {
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
  geometryGeojson: string | null;
}): number | null {
  const acres = effectiveAcresFor({
    acres: storedSketchAcres(row.acres, row.widthFt, row.lengthFt),
    geometryGeojson: row.geometryGeojson
  });
  if (acres !== undefined && acres > 0) return acres * SQFT_PER_ACRE;
  if (row.widthFt && row.lengthFt) return row.widthFt * row.lengthFt;
  return null;
}

/** An owner-typed target (`manual`) or the sourced default (`fallback`). */
export function resolveTarget(raw: string | null | undefined): WaterTarget | null {
  const n = raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isFinite(n) && n >= WATER_TARGET_MIN_IN && n <= WATER_TARGET_MAX_IN) {
    return { inches: n, provenance: 'manual' };
  }
  return DEFAULT_WEEKLY_TARGET_IN === null
    ? null
    : { inches: DEFAULT_WEEKLY_TARGET_IN, provenance: 'fallback' };
}

/** One read: the given beds joined to their garden or field Area, covers and water target. */
export function loadAreasForBeds(
  blockIds: readonly string[],
  nowMs: number,
  farmPoint: { lat: number; lon: number } | null
): AreaWaterInput[] {
  if (blockIds.length === 0) return [];
  const rows = db
    .select({
      blockId: blocks.id,
      blockName: blocks.name,
      blockLabel: blocks.blockLabel,
      bAcres: blocks.acres,
      bWidth: blocks.widthFt,
      bLength: blocks.lengthFt,
      bGeo: blocks.geometryGeojson,
      fieldId: fields.id,
      fieldName: fields.name,
      fieldKind: fields.kind,
      fAcres: fields.acres,
      fWidth: fields.widthFt,
      fLength: fields.lengthFt,
      fGeo: fields.geometryGeojson,
      target: appSettings.value,
      pId: blockProtections.id,
      pKind: blockProtections.kind,
      pInstalled: blockProtections.installedOn,
      pRemoved: blockProtections.removedOn,
      pSeason: blockProtections.seasonYear
    })
    .from(blocks)
    .innerJoin(fields, and(eq(fields.id, blocks.fieldId), eq(fields.ownerId, blocks.ownerId)))
    .leftJoin(
      appSettings,
      and(
        eq(appSettings.ownerId, fields.ownerId),
        eq(appSettings.key, sql`${TARGET_PREFIX} || ${fields.id}`)
      )
    )
    .leftJoin(
      blockProtections,
      and(eq(blockProtections.blockId, blocks.id), eq(blockProtections.ownerId, blocks.ownerId))
    )
    .where(
      withTenant(
        blocks,
        inArray(blocks.id, [...blockIds]),
        inArray(fields.kind, [...WATERED_AREA_KINDS])
      )
    )
    .all();

  const areas = new Map<string, AreaWaterInput>();
  const beds = new Map<string, BedInput>();
  for (const r of rows) {
    let area = areas.get(r.fieldId);
    if (!area) {
      const c = r.fGeo ? geometryCentroid(r.fGeo) : null;
      area = {
        fieldId: r.fieldId,
        name: r.fieldName,
        kind: r.fieldKind,
        point: c ?? farmPoint,
        sqFt: sqFtOf({
          acres: r.fAcres,
          widthFt: r.fWidth,
          lengthFt: r.fLength,
          geometryGeojson: r.fGeo
        }),
        target: resolveTarget(r.target),
        beds: []
      };
      areas.set(r.fieldId, area);
    }
    let bed = beds.get(r.blockId);
    if (!bed) {
      bed = {
        id: r.blockId,
        name: r.blockLabel ?? r.blockName,
        sqFt: sqFtOf({
          acres: r.bAcres,
          widthFt: r.bWidth,
          lengthFt: r.bLength,
          geometryGeojson: r.bGeo
        }),
        rainCover: null
      };
      beds.set(r.blockId, bed);
      area.beds.push(bed);
    }
    if (r.pId && r.pKind && shedsRain(r.pKind as ProtectionKind) && !bed.rainCover) {
      const p: BlockProtection = {
        id: r.pId,
        blockId: r.blockId,
        kind: r.pKind as ProtectionKind,
        springShiftDays: null,
        fallShiftDays: null,
        provenance: 'manual',
        installedOn: r.pInstalled ? r.pInstalled.getTime() : null,
        removedOn: r.pRemoved ? r.pRemoved.getTime() : null,
        seasonYear: r.pSeason ?? null
      };
      if (isActiveAt(p, nowMs)) bed.rainCover = p.kind;
    }
  }
  for (const a of areas.values()) a.beds.sort((x, y) => x.name.localeCompare(y.name));
  return [...areas.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function loadLogs(fieldIds: string[], fromMs: number, nowMs: number) {
  return db
    .select({
      fieldId: irrigationEvents.fieldId,
      blockId: irrigationEvents.blockId,
      occurredAt: irrigationEvents.occurredAt,
      inches: irrigationEvents.inches,
      gallons: irrigationEvents.gallons,
      durationMin: irrigationEvents.durationMin
    })
    .from(irrigationEvents)
    .where(
      withTenant(
        irrigationEvents,
        inArray(irrigationEvents.fieldId, fieldIds),
        gte(irrigationEvents.occurredAt, new Date(fromMs)),
        lte(irrigationEvents.occurredAt, new Date(nowMs))
      )
    )
    .all();
}

function loadGauges(fieldIds: string[], fromMs: number, nowMs: number) {
  return db
    .select({
      fieldId: rainGaugeReadings.fieldId,
      readAt: rainGaugeReadings.readAt,
      inches: rainGaugeReadings.inches
    })
    .from(rainGaugeReadings)
    .where(
      withTenant(
        rainGaugeReadings,
        inArray(rainGaugeReadings.fieldId, fieldIds),
        gte(rainGaugeReadings.readAt, new Date(fromMs)),
        lte(rainGaugeReadings.readAt, new Date(nowMs))
      )
    )
    .all();
}

/** The global, location-keyed weather cache is shared by every farm. */
function readWeatherCache(keys: string[], nowMs: number): Map<string, unknown[]> {
  unscopedQueryNote('weather_forecast_cache is a global location-keyed cache');
  const out = new Map<string, unknown[]>();
  if (keys.length === 0) return out;
  const rows = db
    .select()
    .from(weatherForecastCache)
    .where(inArray(weatherForecastCache.cacheKey, keys))
    .all();
  for (const r of rows) {
    if (r.expiresAt.getTime() <= nowMs) continue;
    try {
      const v = JSON.parse(r.payloadJson) as unknown;
      if (Array.isArray(v)) out.set(r.cacheKey, v);
    } catch {
      /* a bad row reads as a miss */
    }
  }
  return out;
}

function stationFor(
  station: ObservedStation | null,
  point: { lat: number; lon: number } | null
): StationRef | null {
  if (!station) return null;
  const from = point ?? { lat: station.lat, lon: station.lon };
  const miles = haversineFt(from.lat, from.lon, station.lat, station.lon) / FT_PER_MILE;
  return { name: stationLabel(station), distanceMi: Math.round(miles * 10) / 10 };
}

function forecastInches(hours: readonly HourlyPoint[], nowMs: number): number | null {
  const from = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const next = hours.filter((h) => h.t >= from && h.t < from + 24 * HOUR_MS);
  if (next.length === 0) return null;
  const mm = next.reduce((s, h) => s + (h.precipMm ?? 0), 0);
  return Math.round((mm / 25.4) * 100) / 100;
}

export interface AreaWaterResult {
  area: AreaWaterInput;
  balance: WaterBalance;
  nearestStation: StationRef | null;
  forecastIn: number | null;
}

/** Verdicts for the given Areas, sharing one weather lookup. */
export async function computeAreaWater(
  areas: readonly AreaWaterInput[],
  opts: {
    nowMs: number;
    farmPoint: { lat: number; lon: number } | null;
    deps?: WaterAdviceDeps;
  }
): Promise<AreaWaterResult[]> {
  if (areas.length === 0) return [];
  const { nowMs, farmPoint } = opts;
  const { startMs } = windowBounds(nowMs);
  const fieldIds = areas.map((a) => a.fieldId);
  const logs = loadLogs(fieldIds, startMs, nowMs);
  const gauges = loadGauges(fieldIds, startMs - GAUGE_LOOKBACK_MS, nowMs);

  const anchor = farmPoint ?? areas.find((a) => a.point)?.point ?? null;
  const station = anchor ? (nearestObservedStations(anchor.lat, anchor.lon, 1)[0] ?? null) : null;
  const refs = new Map(areas.map((a) => [a.fieldId, stationFor(station, a.point)]));
  const stationUseful =
    station !== null &&
    areas.some((a) => {
      const ref = refs.get(a.fieldId);
      return a.kind !== 'greenhouse' && ref !== null && ref !== undefined && a.point !== null
        ? ref.distanceMi <= MAX_STATION_MILES
        : false;
    });

  const rainKey = station ? observedRainKey(station.icao) : null;
  const forecastKey = anchor ? hourlyCacheKey(anchor.lat, anchor.lon) : null;
  const cache = readWeatherCache(
    [stationUseful ? rainKey : null, forecastKey].filter((k): k is string => k !== null),
    nowMs
  );

  let rain: RainHour[] = [];
  if (stationUseful && station && rainKey) {
    const hit = cache.get(rainKey) as RainHour[] | undefined;
    rain = hit ?? (await getObservedRain(station, nowMs, opts.deps)).hours;
  }
  let forecast: HourlyPoint[] | null = null;
  if (forecastKey && anchor) {
    const hit = cache.get(forecastKey) as HourlyPoint[] | undefined;
    if (hit) forecast = hit;
    else if (opts.deps?.forecast)
      forecast = await opts.deps.forecast(anchor.lat, anchor.lon, nowMs);
    else forecast = (await getHourlyForecastSafely(anchor.lat, anchor.lon, nowMs)).hours;
  }
  const forecastIn = forecast ? forecastInches(forecast, nowMs) : null;

  return areas.map((area) => {
    const ref = area.point ? (refs.get(area.fieldId) ?? null) : null;
    const periods = gaugePeriods(
      gauges
        .filter((g) => g.fieldId === area.fieldId)
        .map((g) => ({ readAtMs: g.readAt.getTime(), inches: g.inches }))
    );
    const balance = waterBalance({
      nowMs,
      areaKind: area.kind,
      areaSqFt: area.sqFt,
      target: area.target,
      station: ref,
      stationRain: ref && ref.distanceMi <= MAX_STATION_MILES ? rain : [],
      gauges: periods,
      logs: logs
        .filter((l) => l.fieldId === area.fieldId)
        .map((l) => ({
          occurredAtMs: l.occurredAt.getTime(),
          blockId: l.blockId ?? null,
          inches: l.inches ?? null,
          gallons: l.gallons ?? null,
          durationMin: l.durationMin ?? null
        })),
      beds: area.beds
    });
    return { area, balance, nearestStation: ref, forecastIn };
  });
}

/** Garden and field Areas with a crop in the ground, as /today watering cards (E4-11). */
export async function wateringCards(
  ctx: TodayAdviceContext,
  deps?: WaterAdviceDeps
): Promise<TodayAdviceCard[]> {
  const blockIds = [
    ...new Set(ctx.plantings.filter((p) => isInGround(p, ctx.nowMs)).map((p) => p.blockId))
  ];
  if (blockIds.length === 0) return [];
  const areas = loadAreasForBeds(blockIds, ctx.nowMs, ctx.farmLatLon);
  const results = await computeAreaWater(areas, {
    nowMs: ctx.nowMs,
    farmPoint: ctx.farmLatLon,
    deps
  });
  return results.map((r) =>
    wateringCard({
      fieldId: r.area.fieldId,
      areaName: r.area.name,
      balance: r.balance,
      nearestStation: r.nearestStation,
      forecastIn: r.forecastIn,
      timeZone: ctx.timeZone ?? 'America/New_York',
      noLocation: r.area.point === null
    })
  );
}

export const wateringAdvice: TodayAdviceProvider = (ctx) => wateringCards(ctx);
