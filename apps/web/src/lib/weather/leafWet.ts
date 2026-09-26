export const HOUR_MS = 60 * 60 * 1000;
export const LEAF_WET_RH_PCT = 90;
export const DEFAULT_RAINFAST_HOURS = 4;
export const DEFAULT_MAX_POP_PCT = 30;
export const DEFAULT_LEAF_WET_THRESHOLD_HOURS = 6;
export const DEFAULT_TIME_ZONE = 'America/New_York';

export type WeatherProvenance = 'data' | 'fallback';

export interface HourlyPoint {
  /** Hour start, ms epoch (UTC, floored to the hour). */
  t: number;
  tempF: number | null;
  dewpointF: number | null;
  rhPct: number | null;
  popPct: number | null;
  precipMm: number | null;
  windMph: number | null;
}

export interface WindowCount {
  wetHours: number;
  coveredHours: number;
}

export interface LeafWetSummary {
  past24h: WindowCount;
  next24h: WindowCount;
  past48h: WindowCount;
  next48h: WindowCount;
}

export interface DailyTotal {
  date: string;
  value: number;
  coveredHours: number;
}

export interface DryWindow {
  startMs: number;
  endMs: number;
  hours: number;
}

export interface DryWindowOptions {
  fromMs: number;
  minHours?: number;
  maxPopPct?: number;
  horizonHours?: number;
}

export type RainfastStatus = 'clear' | 'rain-risk' | 'unknown';

export interface RainfastCheck {
  status: RainfastStatus;
  rainfastHours: number;
  /** First hour inside the rainfast window with measurable precip or PoP ≥ threshold. */
  firstRiskMs: number | null;
  maxPopPct: number | null;
  totalPrecipMm: number;
  coveredHours: number;
}

export interface HourlyDerived {
  provenance: WeatherProvenance;
  leafWet: LeafWetSummary;
  dailyLeafWet: DailyTotal[];
  dailyRain: DailyTotal[];
  rainfast: RainfastCheck;
  dryWindow: DryWindow | null;
}

export function floorHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function hasPrecip(h: HourlyPoint): boolean {
  return h.precipMm !== null && h.precipMm > 0;
}

/** RH ≥ 90% proxy for leaf wetness; hours with measurable precip also count as wet. */
export function isLeafWet(h: HourlyPoint): boolean {
  if (hasPrecip(h)) return true;
  return h.rhPct !== null && h.rhPct >= LEAF_WET_RH_PCT;
}

/** A dry hour needs every relevant field known: no precip, PoP below threshold, RH < 90. */
export function isDryHour(h: HourlyPoint, maxPopPct = DEFAULT_MAX_POP_PCT): boolean {
  if (h.precipMm === null || h.popPct === null || h.rhPct === null) return false;
  return h.precipMm === 0 && h.popPct < maxPopPct && h.rhPct < LEAF_WET_RH_PCT;
}

function sortedUnique(hours: HourlyPoint[]): HourlyPoint[] {
  const byT = new Map<number, HourlyPoint>();
  for (const h of hours) byT.set(floorHour(h.t), { ...h, t: floorHour(h.t) });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export function leafWetHoursInRange(
  hours: HourlyPoint[],
  startMs: number,
  endMs: number
): WindowCount {
  let wetHours = 0;
  let coveredHours = 0;
  for (const h of sortedUnique(hours)) {
    if (h.t < startMs || h.t >= endMs) continue;
    coveredHours++;
    if (isLeafWet(h)) wetHours++;
  }
  return { wetHours, coveredHours };
}

export function summarizeLeafWet(hours: HourlyPoint[], nowMs: number): LeafWetSummary {
  const now = floorHour(nowMs);
  return {
    past24h: leafWetHoursInRange(hours, now - 24 * HOUR_MS, now),
    next24h: leafWetHoursInRange(hours, now, now + 24 * HOUR_MS),
    past48h: leafWetHoursInRange(hours, now - 48 * HOUR_MS, now),
    next48h: leafWetHoursInRange(hours, now, now + 48 * HOUR_MS)
  };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function localDateKey(ms: number, timeZone = DEFAULT_TIME_ZONE): string {
  let fmt = dateFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    dateFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(ms));
}

function bucketByDay(
  hours: HourlyPoint[],
  timeZone: string,
  valueOf: (h: HourlyPoint) => number
): DailyTotal[] {
  const byDay = new Map<string, DailyTotal>();
  for (const h of sortedUnique(hours)) {
    const date = localDateKey(h.t, timeZone);
    const d = byDay.get(date) ?? { date, value: 0, coveredHours: 0 };
    d.value += valueOf(h);
    d.coveredHours++;
    byDay.set(date, d);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function dailyLeafWetHours(
  hours: HourlyPoint[],
  timeZone = DEFAULT_TIME_ZONE
): DailyTotal[] {
  return bucketByDay(hours, timeZone, (h) => (isLeafWet(h) ? 1 : 0));
}

/** Daily precip totals (mm) for up to `days` local days starting with the day containing `fromMs`. */
export function dailyRainTotals(
  hours: HourlyPoint[],
  fromMs: number,
  days = 5,
  timeZone = DEFAULT_TIME_ZONE
): DailyTotal[] {
  const firstDay = localDateKey(fromMs, timeZone);
  return bucketByDay(hours, timeZone, (h) => h.precipMm ?? 0)
    .filter((d) => d.date >= firstDay)
    .slice(0, days)
    .map((d) => ({ ...d, value: Math.round(d.value * 100) / 100 }));
}

/** Next contiguous run of ≥ minHours dry hours at or after the hour containing `fromMs`. */
export function findDryWindow(hours: HourlyPoint[], opts: DryWindowOptions): DryWindow | null {
  const minHours = Math.max(1, Math.ceil(opts.minHours ?? DEFAULT_RAINFAST_HOURS));
  const maxPopPct = opts.maxPopPct ?? DEFAULT_MAX_POP_PCT;
  const start = floorHour(opts.fromMs);
  const end = start + (opts.horizonHours ?? 72) * HOUR_MS;
  let runStart: number | null = null;
  let prevT: number | null = null;
  for (const h of sortedUnique(hours)) {
    if (h.t < start || h.t >= end) continue;
    const contiguous = prevT !== null && h.t === prevT + HOUR_MS;
    prevT = h.t;
    if (!isDryHour(h, maxPopPct)) {
      runStart = null;
      continue;
    }
    if (runStart === null || !contiguous) runStart = h.t;
    const runHours = (h.t - runStart) / HOUR_MS + 1;
    if (runHours >= minHours) {
      return { startMs: runStart, endMs: runStart + minHours * HOUR_MS, hours: minHours };
    }
  }
  return null;
}

/** Would rain inside the rainfast window starting now wash the product off? */
export function checkRainfast(
  hours: HourlyPoint[],
  nowMs: number,
  rainfastHours = DEFAULT_RAINFAST_HOURS,
  maxPopPct = DEFAULT_MAX_POP_PCT
): RainfastCheck {
  const windowHours = Math.max(1, Math.ceil(rainfastHours));
  const start = floorHour(nowMs);
  const end = start + windowHours * HOUR_MS;
  let firstRiskMs: number | null = null;
  let maxPop: number | null = null;
  let totalPrecipMm = 0;
  let coveredHours = 0;
  for (const h of sortedUnique(hours)) {
    if (h.t < start || h.t >= end) continue;
    coveredHours++;
    if (h.popPct !== null) maxPop = Math.max(maxPop ?? 0, h.popPct);
    if (h.precipMm !== null) totalPrecipMm += h.precipMm;
    const risky = hasPrecip(h) || (h.popPct !== null && h.popPct >= maxPopPct);
    if (risky && firstRiskMs === null) firstRiskMs = h.t;
  }
  const status: RainfastStatus =
    firstRiskMs !== null ? 'rain-risk' : coveredHours < windowHours ? 'unknown' : 'clear';
  return {
    status,
    rainfastHours: windowHours,
    firstRiskMs,
    maxPopPct: maxPop,
    totalPrecipMm: Math.round(totalPrecipMm * 100) / 100,
    coveredHours
  };
}

export interface DeriveOptions {
  nowMs: number;
  rainfastHours?: number;
  maxPopPct?: number;
  timeZone?: string;
}

export function deriveHourly(
  hours: HourlyPoint[],
  provenance: WeatherProvenance,
  opts: DeriveOptions
): HourlyDerived {
  const rainfastHours = opts.rainfastHours ?? DEFAULT_RAINFAST_HOURS;
  const maxPopPct = opts.maxPopPct ?? DEFAULT_MAX_POP_PCT;
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  return {
    provenance,
    leafWet: summarizeLeafWet(hours, opts.nowMs),
    dailyLeafWet: dailyLeafWetHours(hours, timeZone),
    dailyRain: dailyRainTotals(hours, opts.nowMs, 5, timeZone),
    rainfast: checkRainfast(hours, opts.nowMs, rainfastHours, maxPopPct),
    dryWindow: findDryWindow(hours, { fromMs: opts.nowMs, minHours: rainfastHours, maxPopPct })
  };
}

/**
 * Observed hours before the current hour, forecast hours from it on. Where both
 * cover a past hour the observation wins; where both cover a later hour the
 * forecast wins. Each side fills the other's gaps.
 */
export function mergeObservedAndForecast(
  observed: readonly HourlyPoint[],
  forecast: readonly HourlyPoint[],
  nowMs: number
): HourlyPoint[] {
  const now = floorHour(nowMs);
  const byT = new Map<number, HourlyPoint>();
  const put = (h: HourlyPoint, wins: boolean) => {
    const t = floorHour(h.t);
    if (wins || !byT.has(t)) byT.set(t, { ...h, t });
  };
  for (const h of forecast) put(h, floorHour(h.t) >= now);
  for (const h of observed) put(h, floorHour(h.t) < now);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Most conservative (longest) label rainfast interval across a tank mix. */
export function tankMixRainfastHours(products: Array<{ rainfastHours?: number | null }>): {
  hours: number;
  fromLabel: boolean;
} {
  const known = products
    .map((p) => p.rainfastHours)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  if (known.length === 0) return { hours: DEFAULT_RAINFAST_HOURS, fromLabel: false };
  return { hours: Math.max(...known), fromLabel: true };
}
