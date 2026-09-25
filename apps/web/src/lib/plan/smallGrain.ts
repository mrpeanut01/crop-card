/**
 * Small-grain plan model (#177, UC-50) — pure, client-safe.
 *
 * Three advisory panels for plantings whose archetype is `small-grain.zadoks`:
 *
 * 1. Zadoks timeline. Plugin-authored stage tables (`growthStageTable` /
 *    legacy `zadoksStages`) are used where they exist (provenance `plugin`).
 *    Otherwise a "typical" table below (provenance `fallback`). Winter-habit
 *    crops always take their post-dormancy stages (Z30+) from the calendar-
 *    anchored typical table, because a days-from-planting offset cannot model
 *    winter dormancy: a mid-October and a mid-November drilling both joint in
 *    late March. The anchors are Mid-Atlantic soft red winter wheat timings
 *    (VCE Small Grains Production Guide / Penn State Agronomy Guide), suitable
 *    for Loudoun County, VA. Spring-habit offsets are scaled by the plugin's
 *    days-to-maturity midpoint against a 100-day reference.
 *
 * 2. FHB (Fusarium head blight / scab) risk proxy. The US Wheat & Barley Scab
 *    Initiative models (De Wolf et al. 2003) key on hours of high humidity at
 *    15–30 °C in the ~7 days before anthesis. We count "scab-favorable" hours
 *    (RH ≥ 90% or measurable rain, and 59–86 °F) in the 7 days before the
 *    projected start of anthesis (Z61), scale to a full 168-hour window by
 *    coverage, and bucket: < 24 h low, 24–48 h moderate, ≥ 48 h high. The
 *    thresholds are a proxy, not the calibrated national model — the UI links
 *    to wheatscab.psu.edu.
 *
 * 3. Vernalization. Winter-habit crops need ~6 weeks (42 days) of 32–50 °F.
 *    Each hour since planting counts 1/24 day when its temperature is in
 *    range. Hours covered by the forecast feed use the observed/forecast
 *    temperature (`data`); earlier hours use a climatology estimate from
 *    Dulles (IAD) 1991–2020 monthly normal means, assuming a uniform ±9 °F
 *    diurnal swing around the daily mean (`fallback`).
 *
 * Nothing here is a safety-kernel rule; all output is advisory.
 */

import type { GrowthStageTable } from '$lib/plugins/schemas';
import { normalizeZadoksToGrowthStageTable } from '$lib/plugins/growthStageTemplates';
import { projectStages } from '$lib/calendar/stageProjection';
import { soilTempForDayOfYear } from '$lib/weather/normals';
import {
  DEFAULT_TIME_ZONE,
  floorHour,
  HOUR_MS,
  isLeafWet,
  localDateKey,
  type HourlyPoint,
  type WeatherProvenance
} from '$lib/weather/leafWet';

export const DAY_MS = 24 * HOUR_MS;

export type GrowthHabit = 'winter' | 'spring';
export type StageProvenance = 'plugin' | 'fallback';
export type DecisionKind = 'herbicide-cutoff' | 'flag-leaf' | 'heading' | 'fhb-window' | 'harvest';

export interface SmallGrainStage {
  code: string;
  zadoks: number;
  name: string;
  startMs: number;
  endMs: number;
  provenance: StageProvenance;
  decision?: DecisionKind;
}

export interface SmallGrainPluginInput {
  pluginId: string;
  displayName: string;
  daysToMaturity?: { min: number; max: number };
  growthStageTable?: GrowthStageTable;
  zadoksStages?: Parameters<typeof normalizeZadoksToGrowthStageTable>[0];
}

export function zadoksNumber(code: string): number | null {
  const m = /^Z(\d{1,2})/i.exec(code.trim());
  return m ? parseInt(m[1], 10) : null;
}

/** Stage whose days-from-planting band contains `days` (legacy renderer semantics). */
export function stageForDaysFromPlanting<
  T extends { daysFromPlanting: { min: number; max: number } }
>(stages: readonly T[], days: number): T | null {
  return (
    stages.find((s) => days >= s.daysFromPlanting.min && days <= s.daysFromPlanting.max) ?? null
  );
}

export function inferGrowthHabit(plugin: SmallGrainPluginInput): GrowthHabit {
  const label = `${plugin.pluginId} ${plugin.displayName}`;
  if (/\b(spring|vernal)\b/i.test(label)) return 'spring';
  if (/winter/i.test(label)) return 'winter';
  const dtm = plugin.daysToMaturity;
  if (dtm && (dtm.min + dtm.max) / 2 >= 180) return 'winter';
  return 'spring';
}

interface TypicalStage {
  code: string;
  name: string;
}

const STAGE_NAMES: Record<string, string> = {
  Z00: 'Sown (dry seed)',
  Z10: 'First leaf through coleoptile',
  Z13: 'Three leaves unfolded',
  Z21: 'Main shoot + 1 tiller',
  Z30: 'Jointing begins (pseudo-stem erect)',
  Z32: 'Second node detectable',
  Z39: 'Flag leaf ligule visible',
  Z45: 'Boot swollen',
  Z55: 'Heading (half of head out)',
  Z61: 'Anthesis begins',
  Z65: 'Mid-anthesis',
  Z75: 'Medium milk',
  Z85: 'Soft dough',
  Z92: 'Harvest-ripe (grain hard)'
};

const named = (code: string): TypicalStage => ({ code, name: STAGE_NAMES[code] });

/** Winter habit, pre-dormancy: days after sowing. */
export const WINTER_FALL_OFFSETS: ReadonlyArray<TypicalStage & { days: number }> = [
  { ...named('Z00'), days: 0 },
  { ...named('Z10'), days: 7 },
  { ...named('Z13'), days: 21 },
  { ...named('Z21'), days: 35 }
];

/** Winter habit, post-dormancy: typical Mid-Atlantic calendar dates (month 1-12). */
export const WINTER_SPRING_ANCHORS: ReadonlyArray<TypicalStage & { month: number; day: number }> = [
  { ...named('Z30'), month: 3, day: 25 },
  { ...named('Z32'), month: 4, day: 8 },
  { ...named('Z39'), month: 4, day: 22 },
  { ...named('Z45'), month: 4, day: 30 },
  { ...named('Z55'), month: 5, day: 7 },
  { ...named('Z61'), month: 5, day: 12 },
  { ...named('Z65'), month: 5, day: 15 },
  { ...named('Z75'), month: 5, day: 30 },
  { ...named('Z85'), month: 6, day: 8 },
  { ...named('Z92'), month: 6, day: 22 }
];

export const SPRING_REFERENCE_DTM = 100;
/** Spring habit: days after sowing at a 100-day reference maturity. */
export const SPRING_OFFSETS: ReadonlyArray<TypicalStage & { days: number }> = [
  { ...named('Z00'), days: 0 },
  { ...named('Z10'), days: 7 },
  { ...named('Z13'), days: 18 },
  { ...named('Z21'), days: 28 },
  { ...named('Z30'), days: 40 },
  { ...named('Z32'), days: 47 },
  { ...named('Z39'), days: 55 },
  { ...named('Z45'), days: 60 },
  { ...named('Z55'), days: 65 },
  { ...named('Z61'), days: 70 },
  { ...named('Z65'), days: 73 },
  { ...named('Z75'), days: 83 },
  { ...named('Z85'), days: 92 },
  { ...named('Z92'), days: 100 }
];

const MIN_STAGE_GAP_MS = 3 * DAY_MS;

function noonUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 12);
}

/** Calendar year in which a winter-habit crop sown at `plantMs` resumes growth. */
export function springYearFor(plantMs: number): number {
  const d = new Date(plantMs);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

function pluginStageTable(plugin: SmallGrainPluginInput): GrowthStageTable | null {
  if (plugin.growthStageTable && plugin.growthStageTable.stages.length > 0) {
    return plugin.growthStageTable;
  }
  return normalizeZadoksToGrowthStageTable(plugin.zadoksStages);
}

interface RawStage {
  code: string;
  name: string;
  startMs: number;
  provenance: StageProvenance;
}

function pluginRawStages(plugin: SmallGrainPluginInput, plantMs: number): RawStage[] {
  const table = pluginStageTable(plugin);
  if (!table) return [];
  return projectStages(plantMs, table, plugin.daysToMaturity)
    .filter((s) => zadoksNumber(s.code) !== null)
    .map((s) => ({ code: s.code, name: s.name, startMs: s.startMs, provenance: 'plugin' }));
}

function assignDecisions(stages: SmallGrainStage[]): void {
  const firstIn = (lo: number, hi: number) => stages.find((s) => s.zadoks >= lo && s.zadoks <= hi);
  const tag = (s: SmallGrainStage | undefined, d: DecisionKind) => {
    if (s && !s.decision) s.decision = d;
  };
  tag(firstIn(30, 32), 'herbicide-cutoff');
  tag(firstIn(37, 39), 'flag-leaf');
  tag(firstIn(50, 59), 'heading');
  tag(firstIn(60, 69), 'fhb-window');
  const last = stages[stages.length - 1];
  if (last && last.zadoks >= 83) tag(last, 'harvest');
}

/**
 * Projected Zadoks timeline. Stages are sorted by Zadoks number and forced to
 * be strictly increasing in date (a late or spring sowing of a winter-habit
 * crop would otherwise put fall stages after the spring anchors).
 */
export function buildZadoksTimeline(
  plugin: SmallGrainPluginInput,
  plantMs: number,
  habit: GrowthHabit = inferGrowthHabit(plugin)
): SmallGrainStage[] {
  const fromPlugin = pluginRawStages(plugin, plantMs);
  let raw: RawStage[];
  if (habit === 'winter') {
    const fall =
      fromPlugin.filter((s) => (zadoksNumber(s.code) ?? 0) < 30).length > 0
        ? fromPlugin.filter((s) => (zadoksNumber(s.code) ?? 0) < 30)
        : WINTER_FALL_OFFSETS.map<RawStage>((s) => ({
            code: s.code,
            name: s.name,
            startMs: plantMs + s.days * DAY_MS,
            provenance: 'fallback'
          }));
    const year = springYearFor(plantMs);
    const spring = WINTER_SPRING_ANCHORS.map<RawStage>((s) => ({
      code: s.code,
      name: s.name,
      startMs: noonUtc(year, s.month, s.day),
      provenance: 'fallback'
    }));
    raw = [...fall, ...spring];
  } else if (fromPlugin.length > 0) {
    raw = fromPlugin;
  } else {
    const dtm = plugin.daysToMaturity;
    const scale = dtm ? (dtm.min + dtm.max) / 2 / SPRING_REFERENCE_DTM : 1;
    raw = SPRING_OFFSETS.map<RawStage>((s) => ({
      code: s.code,
      name: s.name,
      startMs: plantMs + Math.round(s.days * scale * DAY_MS),
      provenance: 'fallback'
    }));
  }

  const sorted = raw
    .map((s) => ({ ...s, zadoks: zadoksNumber(s.code) as number }))
    .sort((a, b) => a.zadoks - b.zadoks);
  const out: SmallGrainStage[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.zadoks === s.zadoks) continue;
    const startMs = prev ? Math.max(s.startMs, prev.startMs + MIN_STAGE_GAP_MS) : s.startMs;
    out.push({ ...s, startMs, endMs: startMs + 7 * DAY_MS });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].endMs = out[i + 1].startMs;
  assignDecisions(out);
  return out;
}

/** Index of the last stage whose start is ≤ now; -1 before the first stage. */
export function currentStageIndex(stages: readonly SmallGrainStage[], nowMs: number): number {
  let idx = -1;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].startMs <= nowMs) idx = i;
    else break;
  }
  return idx;
}

/** Projected date a Zadoks number is reached, interpolating between stages. */
export function dateAtZadoks(stages: readonly SmallGrainStage[], z: number): number | null {
  if (stages.length === 0) return null;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (s.zadoks === z) return s.startMs;
    if (s.zadoks > z) {
      if (i === 0) return null;
      const p = stages[i - 1];
      const t = (z - p.zadoks) / (s.zadoks - p.zadoks);
      return Math.round(p.startMs + t * (s.startMs - p.startMs));
    }
  }
  return null;
}

export const ANTHESIS_ZADOKS = 61;

// ─── FHB ───────────────────────────────────────────────────────────────

export const FHB_WINDOW_HOURS = 7 * 24;
export const FHB_TEMP_MIN_F = 59;
export const FHB_TEMP_MAX_F = 86;
export const FHB_MODERATE_HOURS = 24;
export const FHB_HIGH_HOURS = 48;
export const FHB_MIN_COVERAGE_HOURS = 24;
/** Triazole FHB fungicides remain effective up to ~6 days after early anthesis. */
export const FHB_SPRAY_WINDOW_AFTER_DAYS = 6;

export type FhbRiskLevel = 'low' | 'moderate' | 'high';
export type FhbStatus =
  'no-anthesis' | 'too-early' | 'past' | 'no-data' | 'insufficient-data' | 'assessed';

export interface FhbAssessment {
  status: FhbStatus;
  anthesisMs: number | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  favorableHours: number;
  coveredHours: number;
  /** Favorable hours scaled to the full 168-hour window. */
  index: number;
  meanTempF: number | null;
  level: FhbRiskLevel | null;
  provenance: WeatherProvenance;
}

export function isScabFavorableHour(h: HourlyPoint): boolean {
  if (h.tempF === null || h.tempF < FHB_TEMP_MIN_F || h.tempF > FHB_TEMP_MAX_F) return false;
  return isLeafWet(h);
}

export function fhbLevel(index: number): FhbRiskLevel {
  if (index >= FHB_HIGH_HOURS) return 'high';
  if (index >= FHB_MODERATE_HOURS) return 'moderate';
  return 'low';
}

function uniqueHours(hours: readonly HourlyPoint[]): HourlyPoint[] {
  const byT = new Map<number, HourlyPoint>();
  for (const h of hours) byT.set(floorHour(h.t), { ...h, t: floorHour(h.t) });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Scab-favorable hour count over [startMs, endMs). */
export function scabFavorableInRange(
  hours: readonly HourlyPoint[],
  startMs: number,
  endMs: number
): { favorableHours: number; coveredHours: number; meanTempF: number | null } {
  let favorableHours = 0;
  let coveredHours = 0;
  let tSum = 0;
  let tN = 0;
  for (const h of uniqueHours(hours)) {
    if (h.t < startMs || h.t >= endMs) continue;
    coveredHours++;
    if (isScabFavorableHour(h)) favorableHours++;
    if (h.tempF !== null) {
      tSum += h.tempF;
      tN++;
    }
  }
  return {
    favorableHours,
    coveredHours,
    meanTempF: tN > 0 ? Math.round((tSum / tN) * 10) / 10 : null
  };
}

export function assessFhbRisk(input: {
  anthesisMs: number | null;
  hours: readonly HourlyPoint[];
  provenance: WeatherProvenance;
  nowMs: number;
}): FhbAssessment {
  const { anthesisMs, nowMs } = input;
  const base: FhbAssessment = {
    status: 'no-anthesis',
    anthesisMs,
    windowStartMs: null,
    windowEndMs: null,
    favorableHours: 0,
    coveredHours: 0,
    index: 0,
    meanTempF: null,
    level: null,
    provenance: input.provenance
  };
  if (anthesisMs === null) return base;
  const windowEndMs = anthesisMs;
  const windowStartMs = anthesisMs - FHB_WINDOW_HOURS * HOUR_MS;
  const withWindow = { ...base, windowStartMs, windowEndMs };
  if (nowMs > anthesisMs + FHB_SPRAY_WINDOW_AFTER_DAYS * DAY_MS) {
    return { ...withWindow, status: 'past' };
  }
  const hours = input.provenance === 'data' ? uniqueHours(input.hours) : [];
  if (hours.length === 0) {
    return { ...withWindow, status: 'no-data', provenance: 'fallback' };
  }
  const lastHour = hours[hours.length - 1].t;
  if (windowStartMs > lastHour) return { ...withWindow, status: 'too-early' };
  const counts = scabFavorableInRange(hours, windowStartMs, windowEndMs);
  if (counts.coveredHours < FHB_MIN_COVERAGE_HOURS) {
    return { ...withWindow, ...counts, status: 'insufficient-data' };
  }
  const index = Math.round((counts.favorableHours / counts.coveredHours) * FHB_WINDOW_HOURS);
  return { ...withWindow, ...counts, index, level: fhbLevel(index), status: 'assessed' };
}

export interface DailyScabHours {
  date: string;
  favorableHours: number;
  coveredHours: number;
  meanTempF: number | null;
}

export function dailyScabFavorableHours(
  hours: readonly HourlyPoint[],
  timeZone: string = DEFAULT_TIME_ZONE
): DailyScabHours[] {
  const byDay = new Map<string, { fav: number; cov: number; tSum: number; tN: number }>();
  for (const h of uniqueHours(hours)) {
    const date = localDateKey(h.t, timeZone);
    const d = byDay.get(date) ?? { fav: 0, cov: 0, tSum: 0, tN: 0 };
    d.cov++;
    if (isScabFavorableHour(h)) d.fav++;
    if (h.tempF !== null) {
      d.tSum += h.tempF;
      d.tN++;
    }
    byDay.set(date, d);
  }
  return [...byDay.entries()].map(([date, d]) => ({
    date,
    favorableHours: d.fav,
    coveredHours: d.cov,
    meanTempF: d.tN > 0 ? Math.round((d.tSum / d.tN) * 10) / 10 : null
  }));
}

// ─── Vernalization ─────────────────────────────────────────────────────

export const VERNALIZATION_MIN_F = 32;
export const VERNALIZATION_MAX_F = 50;
export const DEFAULT_VERNALIZATION_DAYS = 42;
export const CLIMATOLOGY_DIURNAL_HALF_RANGE_F = 9;

/** Dulles Int'l (IAD), Loudoun County VA — 1991–2020 monthly normal mean air temp, °F. */
export const LOUDOUN_AIR_TEMP_NORMALS = {
  label: 'Loudoun County, VA (Dulles 1991–2020 normals)',
  monthlyMeanF: [33.6, 36.4, 44.3, 55.2, 64.6, 73.2, 77.8, 76.3, 69.2, 57.4, 46.7, 37.9]
} as const;

export function isVernalizingTemp(tempF: number): boolean {
  return tempF >= VERNALIZATION_MIN_F && tempF <= VERNALIZATION_MAX_F;
}

/** Fraction of a day in range when temps swing uniformly ±9 °F around `meanF`. */
export function climatologyVernalizingFraction(meanF: number): number {
  const lo = meanF - CLIMATOLOGY_DIURNAL_HALF_RANGE_F;
  const hi = meanF + CLIMATOLOGY_DIURNAL_HALF_RANGE_F;
  const overlap = Math.min(hi, VERNALIZATION_MAX_F) - Math.max(lo, VERNALIZATION_MIN_F);
  return Math.max(0, Math.min(1, overlap / (hi - lo)));
}

function dayOfYearUtc(ms: number): number {
  const d = new Date(ms);
  return Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
}

export function climatologyMeanF(ms: number): number {
  return soilTempForDayOfYear(Math.min(365, dayOfYearUtc(ms)), {
    label: LOUDOUN_AIR_TEMP_NORMALS.label,
    monthlyMeanF: LOUDOUN_AIR_TEMP_NORMALS.monthlyMeanF
  });
}

export type VernalizationStatus =
  'not-required' | 'not-planted' | 'in-progress' | 'complete' | 'at-risk';

export interface VernalizationAssessment {
  required: boolean;
  status: VernalizationStatus;
  requiredDays: number;
  accumulatedDays: number;
  /** Portion of `accumulatedDays` from the weather feed (the rest is climatology). */
  dataDays: number;
  climatologyDays: number;
  /** Accumulated + in-range forecast hours after now. */
  projectedDays: number;
  progress: number;
  projectedProgress: number;
  provenance: WeatherProvenance;
  springPlanted: boolean;
}

const MAX_VERNALIZATION_SPAN_MS = 400 * DAY_MS;
/** Accumulation stops May 1 of the spring after sowing — later cold is irrelevant to heading. */
export const VERNALIZATION_SEASON_END_MONTH = 5;

export function assessVernalization(input: {
  habit: GrowthHabit;
  plantMs: number | null;
  nowMs: number;
  hours: readonly HourlyPoint[];
  provenance: WeatherProvenance;
  requiredDays?: number;
}): VernalizationAssessment {
  const requiredDays = input.requiredDays ?? DEFAULT_VERNALIZATION_DAYS;
  const empty: VernalizationAssessment = {
    required: input.habit === 'winter',
    status: input.habit === 'winter' ? 'not-planted' : 'not-required',
    requiredDays,
    accumulatedDays: 0,
    dataDays: 0,
    climatologyDays: 0,
    projectedDays: 0,
    progress: 0,
    projectedProgress: 0,
    provenance: 'fallback',
    springPlanted: false
  };
  if (input.habit === 'spring') return empty;
  const { plantMs, nowMs } = input;
  if (plantMs === null || plantMs > nowMs) return empty;

  const byT = new Map<number, number>();
  if (input.provenance === 'data') {
    for (const h of input.hours) if (h.tempF !== null) byT.set(floorHour(h.t), h.tempF);
  }

  const start = floorHour(plantMs);
  const seasonEnd = Math.max(
    start,
    Math.min(
      start + MAX_VERNALIZATION_SPAN_MS,
      noonUtc(springYearFor(plantMs), VERNALIZATION_SEASON_END_MONTH, 1)
    )
  );
  const end = Math.min(nowMs, seasonEnd);
  let dataHours = 0;
  let climatologyHours = 0;
  let usedClimatology = false;
  let climatologyDayMs = -1;
  let climatologyFrac = 0;
  for (let t = start; t < end; t += HOUR_MS) {
    const temp = byT.get(t);
    if (temp !== undefined) {
      if (isVernalizingTemp(temp)) dataHours++;
      continue;
    }
    usedClimatology = true;
    const day = Math.floor(t / DAY_MS);
    if (day !== climatologyDayMs) {
      climatologyDayMs = day;
      climatologyFrac = climatologyVernalizingFraction(climatologyMeanF(t));
    }
    climatologyHours += climatologyFrac;
  }
  let forecastHours = 0;
  for (const [t, temp] of byT) {
    if (t >= end && t < seasonEnd && isVernalizingTemp(temp)) forecastHours++;
  }

  const dataDays = dataHours / 24;
  const climatologyDays = climatologyHours / 24;
  const accumulatedDays = dataDays + climatologyDays;
  const projectedDays = accumulatedDays + forecastHours / 24;
  const progress = Math.min(1, accumulatedDays / requiredDays);
  const projectedProgress = Math.min(1, projectedDays / requiredDays);
  const plantMonth = new Date(plantMs).getUTCMonth();
  const springPlanted = plantMonth >= 1 && plantMonth <= 5;
  const pastSeason = nowMs >= noonUtc(springYearFor(plantMs), 4, 15) && nowMs > plantMs;

  let status: VernalizationStatus = 'in-progress';
  if (progress >= 1) status = 'complete';
  else if (springPlanted || pastSeason) status = 'at-risk';

  return {
    required: true,
    status,
    requiredDays,
    accumulatedDays: Math.round(accumulatedDays * 10) / 10,
    dataDays: Math.round(dataDays * 10) / 10,
    climatologyDays: Math.round(climatologyDays * 10) / 10,
    projectedDays: Math.round(projectedDays * 10) / 10,
    progress,
    projectedProgress,
    provenance: usedClimatology || end <= start ? 'fallback' : 'data',
    springPlanted
  };
}
