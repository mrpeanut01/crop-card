/**
 * Rain-aware watering verdicts (Phase 32E, E4; rulings E4-1 to E4-10).
 * Pure and client-safe. The window is the rolling 168 hours ending now.
 *
 * Rain counts only when it can be trusted: a gauge reading or a station
 * hour covers at least 90% of the window's hours, and the station is within
 * 10 miles. A far or missing station is not evidence of no rain, so both
 * skip and water need that coverage. Watering with no known amount can never
 * turn into "water again".
 */

import { HOUR_MS } from './leafWet';
import type { RainHour } from './metarRain';
import { GALLONS_PER_SQFT_INCH } from './waterSources';
import type { ProtectionKind } from '$lib/climate/protection';

export const WINDOW_HOURS = 168;
export const MAX_STATION_MILES = 10;
export const MIN_COVERAGE = 0.9;
export const GAUGE_LOOKBACK_MS = 7 * 24 * HOUR_MS;
export const GAUGE_DEFAULT_SPAN_MS = 24 * HOUR_MS;
export const MAX_GAUGE_IN = 15;

export type WaterVerdict = 'skip' | 'water' | 'ok' | 'unknown';
export type UnknownReason =
  'greenhouse' | 'no-target' | 'rain-unknown' | 'amount-not-logged' | 'covered';

export interface GaugeReading {
  readAtMs: number;
  inches: number;
}

export interface GaugePeriod {
  fromMs: number;
  toMs: number;
  inches: number;
}

export interface WaterLog {
  occurredAtMs: number;
  blockId: string | null;
  inches: number | null;
  gallons: number | null;
  durationMin: number | null;
}

export interface BedInput {
  id: string;
  name: string;
  sqFt: number | null;
  /** The rain-shedding cover on the bed now, if any (E4-9). */
  rainCover: ProtectionKind | null;
}

export interface WaterTarget {
  inches: number;
  provenance: 'manual' | 'fallback';
}

export interface StationRef {
  name: string;
  distanceMi: number;
}

export interface WaterBalanceInput {
  nowMs: number;
  areaKind: string;
  areaSqFt: number | null;
  target: WaterTarget | null;
  station: StationRef | null;
  stationRain: readonly RainHour[];
  gauges: readonly GaugePeriod[];
  logs: readonly WaterLog[];
  beds: readonly BedInput[];
}

export interface BedVerdict {
  bedId: string;
  bedName: string;
  verdict: WaterVerdict;
  reason: UnknownReason | null;
  shortIn: number | null;
  wateredIn: number;
  /** Latest watering in the window whose amount is not known. */
  unknownLogAtMs: number | null;
  /** The latest unknown-amount log was in gallons, but the Area or bed has
   *  no size to turn gallons into inches. */
  unknownLogNeedsSize: boolean;
  coverKind: ProtectionKind | null;
}

export interface RainSummary {
  /** Rain in the window, inches; a lower bound when coverage is under 100%. */
  inches: number;
  coveredHours: number;
  gaugeHours: number;
  stationHours: number;
  stationCounts: boolean;
  trusted: boolean;
}

export interface WaterBalance {
  verdict: WaterVerdict;
  reason: UnknownReason | null;
  shortIn: number | null;
  coveragePct: number;
  /** Whole hours of the window covered by a gauge reading or station hour. */
  coveredHours: number;
  gaugeHours: number;
  /** Coverage meets E4-5; otherwise `rainIn` is only a lower bound. */
  rainTrusted: boolean;
  rainIn: number | null;
  rainSource: 'station' | 'gauge' | 'both' | null;
  station: StationRef | null;
  target: WaterTarget | null;
  perBed: BedVerdict[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Window edges: the 168 whole hours ending with the current hour. */
export function windowBounds(nowMs: number): { startMs: number; endMs: number } {
  const endMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS + HOUR_MS;
  return { startMs: endMs - WINDOW_HOURS * HOUR_MS, endMs };
}

/**
 * E4-7: a reading is the rain since the Area's previous reading, or the 24
 * hours before it when there is no earlier reading in the last 7 days.
 */
export function gaugePeriods(readings: readonly GaugeReading[]): GaugePeriod[] {
  const sorted = [...readings].sort((a, b) => a.readAtMs - b.readAtMs);
  const out: GaugePeriod[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    let fromMs = r.readAtMs - GAUGE_DEFAULT_SPAN_MS;
    for (let j = i - 1; j >= 0; j--) {
      const prev = sorted[j];
      if (prev.readAtMs >= r.readAtMs) continue;
      if (prev.readAtMs >= r.readAtMs - GAUGE_LOOKBACK_MS) fromMs = prev.readAtMs;
      break;
    }
    out.push({ fromMs, toMs: r.readAtMs, inches: r.inches });
  }
  return out;
}

/** When a new reading taken at `readAtMs` would count rain from. */
export function gaugeCountsFrom(previousReadAtMs: number | null, readAtMs: number): number {
  if (
    previousReadAtMs !== null &&
    previousReadAtMs < readAtMs &&
    previousReadAtMs >= readAtMs - GAUGE_LOOKBACK_MS
  ) {
    return previousReadAtMs;
  }
  return readAtMs - GAUGE_DEFAULT_SPAN_MS;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function stationCounts(station: StationRef | null): boolean {
  return station !== null && station.distanceMi <= MAX_STATION_MILES;
}

/** Hours inside a gauge period take the gauge and ignore the station. */
export function summarizeRain(
  input: Pick<WaterBalanceInput, 'nowMs' | 'station' | 'stationRain' | 'gauges'>
): RainSummary {
  const { startMs, endMs } = windowBounds(input.nowMs);
  const useStation = stationCounts(input.station);
  const stationByHour = new Map<number, number | null>();
  if (useStation) for (const h of input.stationRain) stationByHour.set(h.t, h.inches);
  const gauges = input.gauges.filter(
    (g) => g.toMs > g.fromMs && Number.isFinite(g.inches) && g.inches >= 0
  );

  let inches = 0;
  for (const g of gauges) {
    inches += (g.inches * overlap(g.fromMs, g.toMs, startMs, endMs)) / (g.toMs - g.fromMs);
  }
  let gaugeHours = 0;
  let stationHours = 0;
  for (let t = startMs; t < endMs; t += HOUR_MS) {
    if (gauges.some((g) => overlap(g.fromMs, g.toMs, t, t + HOUR_MS) > 0)) {
      gaugeHours++;
      continue;
    }
    const v = stationByHour.get(t);
    if (v === undefined || v === null) continue;
    stationHours++;
    inches += v;
  }
  const coveredHours = gaugeHours + stationHours;
  return {
    inches: round2(inches),
    coveredHours,
    gaugeHours,
    stationHours,
    stationCounts: useStation,
    trusted: coveredHours >= Math.ceil(MIN_COVERAGE * WINDOW_HOURS)
  };
}

/** Inches a log put on a bed of `sqFt`, or null when the amount is not known (E4-8). */
export function logInches(log: WaterLog, sqFt: number | null): number | null {
  if (log.inches !== null && Number.isFinite(log.inches)) return log.inches;
  if (log.gallons !== null && Number.isFinite(log.gallons) && sqFt !== null && sqFt > 0) {
    return log.gallons / (GALLONS_PER_SQFT_INCH * sqFt);
  }
  return null;
}

const VERDICT_RANK: Record<WaterVerdict, number> = { water: 0, unknown: 1, skip: 2, ok: 3 };

export function verdictRank(v: WaterVerdict): number {
  return VERDICT_RANK[v];
}

function bedVerdict(
  bed: BedInput,
  input: WaterBalanceInput,
  rain: RainSummary,
  startMs: number
): BedVerdict {
  const base = {
    bedId: bed.id,
    bedName: bed.name,
    shortIn: null,
    wateredIn: 0,
    unknownLogAtMs: null,
    unknownLogNeedsSize: false,
    coverKind: bed.rainCover
  };
  if (bed.rainCover) return { ...base, verdict: 'unknown', reason: 'covered' };
  let wateredIn = 0;
  let unknownLogAtMs: number | null = null;
  let unknownLogNeedsSize = false;
  for (const log of input.logs) {
    if (log.occurredAtMs < startMs || log.occurredAtMs > input.nowMs) continue;
    if (log.blockId !== null && log.blockId !== bed.id) continue;
    const size = log.blockId === null ? input.areaSqFt : bed.sqFt;
    const inches = logInches(log, size);
    if (inches === null) {
      if (unknownLogAtMs === null || log.occurredAtMs >= unknownLogAtMs) {
        unknownLogAtMs = log.occurredAtMs;
        unknownLogNeedsSize = log.gallons !== null && Number.isFinite(log.gallons);
      }
    } else {
      wateredIn += inches;
    }
  }
  wateredIn = round2(wateredIn);
  const withLogs = { ...base, wateredIn, unknownLogAtMs, unknownLogNeedsSize };
  if (!input.target) return { ...withLogs, verdict: 'unknown', reason: 'no-target' };
  if (!rain.trusted) return { ...withLogs, verdict: 'unknown', reason: 'rain-unknown' };
  const target = input.target.inches;
  if (rain.inches >= target) return { ...withLogs, verdict: 'skip', reason: null };
  if (unknownLogAtMs !== null) {
    return { ...withLogs, verdict: 'unknown', reason: 'amount-not-logged' };
  }
  const total = rain.inches + wateredIn;
  if (total >= target) return { ...withLogs, verdict: 'ok', reason: null };
  return {
    ...withLogs,
    verdict: 'water',
    reason: null,
    shortIn: Math.max(0.1, round1(target - total))
  };
}

export function waterBalance(input: WaterBalanceInput): WaterBalance {
  const { startMs } = windowBounds(input.nowMs);
  const rain = summarizeRain(input);
  const coveragePct = Math.round((rain.coveredHours / WINDOW_HOURS) * 1000) / 10;
  const rainSource =
    rain.gaugeHours > 0 && rain.stationHours > 0
      ? 'both'
      : rain.gaugeHours > 0
        ? 'gauge'
        : rain.stationHours > 0
          ? 'station'
          : null;
  const common = {
    coveragePct,
    coveredHours: rain.coveredHours,
    gaugeHours: rain.gaugeHours,
    rainTrusted: rain.trusted,
    rainIn: rain.coveredHours > 0 ? rain.inches : null,
    rainSource,
    station: input.station,
    target: input.target
  } as const;

  if (input.areaKind === 'greenhouse') {
    return {
      ...common,
      verdict: 'unknown',
      reason: 'greenhouse',
      shortIn: null,
      perBed: input.beds.map((b) => ({
        bedId: b.id,
        bedName: b.name,
        verdict: 'unknown',
        reason: 'greenhouse',
        shortIn: null,
        wateredIn: 0,
        unknownLogAtMs: null,
        unknownLogNeedsSize: false,
        coverKind: b.rainCover
      }))
    };
  }

  const perBed = input.beds.map((b) => bedVerdict(b, input, rain, startMs));
  const open = perBed.filter((b) => b.reason !== 'covered');
  if (open.length === 0) {
    return { ...common, verdict: 'unknown', reason: 'covered', shortIn: null, perBed };
  }
  const worst = open.reduce((a, b) => (verdictRank(b.verdict) < verdictRank(a.verdict) ? b : a));
  const shorts = open.flatMap((b) => (b.shortIn !== null ? [b.shortIn] : []));
  return {
    ...common,
    verdict: worst.verdict,
    reason: worst.reason,
    shortIn: shorts.length ? Math.max(...shorts) : null,
    perBed
  };
}
