/**
 * Degree-day pest models: which stage a pest is in, and what to watch for.
 *
 * Pure and client-safe. Reads only the pest-model plugin, an accumulation
 * from `lib/climate/degreeDays.ts` and the biofix. It never reads or writes
 * IPM threshold state and never touches `lib/safety`. Advice is about
 * scouting, trapping, covering or hand-picking only.
 */

import type { PestModelPlugin } from '$lib/plugins/schemas';
import { isYmd, type Accumulation } from '$lib/climate/degreeDays';
import { t } from '$lib/i18n';
import { formatCalendarDate } from '$lib/prefs';

export type PestModelStage = PestModelPlugin['stages'][number];

/** Stored per Owner and year in app settings `pest_biofix.<modelId>.<year>`. */
export interface StoredBiofix {
  date: string;
  byUserId: string | null;
  at: number;
}

export type BiofixProvenance = 'plugin' | 'manual' | 'fallback';

export interface ResolvedBiofix {
  kind: PestModelPlugin['biofix']['kind'];
  /** First day counted, YYYY-MM-DD, or null when the grower must record a catch. */
  ymd: string | null;
  provenance: BiofixProvenance | null;
  recordedBy: string | null;
}

export const BIOFIX_SETTING_PREFIX = 'pest_biofix.';

export function biofixSettingKey(modelId: string, year: number): string {
  return `${BIOFIX_SETTING_PREFIX}${modelId}.${year}`;
}

/** Only trap-catch models take a grower-entered biofix. */
export function acceptsManualBiofix(model: Pick<PestModelPlugin, 'biofix'>): boolean {
  return model.biofix.kind === 'first-trap-catch';
}

export function parseStoredBiofix(raw: string | undefined | null): StoredBiofix | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredBiofix>;
    if (typeof v.date !== 'string' || !isYmd(v.date)) return null;
    return {
      date: v.date,
      byUserId: typeof v.byUserId === 'string' ? v.byUserId : null,
      at: typeof v.at === 'number' ? v.at : 0
    };
  } catch {
    return null;
  }
}

export function resolveBiofix(
  model: Pick<PestModelPlugin, 'biofix'>,
  year: number,
  stored: StoredBiofix | null
): ResolvedBiofix {
  const { kind, date } = model.biofix;
  const base = { kind, recordedBy: null };
  if (kind === 'january-1') return { ...base, ymd: `${year}-01-01`, provenance: 'plugin' };
  if (kind === 'first-trap-catch' && stored && stored.date.startsWith(`${year}-`)) {
    return { kind, ymd: stored.date, provenance: 'manual', recordedBy: stored.byUserId };
  }
  if (date && isYmd(`${year}-${date}`)) {
    return { ...base, ymd: `${year}-${date}`, provenance: 'fallback' };
  }
  return { ...base, ymd: null, provenance: null };
}

export type ModelState = 'no-biofix' | 'before-biofix' | 'no-data' | 'counting';

export interface ModelStatus {
  state: ModelState;
  /** The latest stage whose start the lower-bound total has passed. */
  stage: PestModelStage | null;
  /** The total sits inside `stage`'s window (no end means open-ended). */
  inWindow: boolean;
  /** Whether the first stage is reached; 'unknown' when not reached and days are missing. */
  reached: boolean | 'unknown';
  next: { stage: PestModelStage; remaining: number; uncertain: boolean } | null;
  total: number;
  missingDays: number;
  throughYmd: string | null;
}

/** Stages sorted by start. */
function stagesOf(model: Pick<PestModelPlugin, 'stages'>): PestModelStage[] {
  return [...model.stages].sort((a, b) => a.gddFrom - b.gddFrom);
}

export function modelStatus(
  model: Pick<PestModelPlugin, 'stages'>,
  accumulation: Accumulation | null,
  biofix: ResolvedBiofix,
  todayYmd: string
): ModelStatus {
  const stages = stagesOf(model);
  const empty = {
    stage: null,
    inWindow: false,
    total: 0,
    missingDays: 0,
    throughYmd: null
  };
  const first = stages[0] ?? null;
  const firstNext = first ? { stage: first, remaining: first.gddFrom, uncertain: false } : null;
  if (biofix.ymd === null) {
    return { ...empty, state: 'no-biofix', reached: false, next: null };
  }
  if (biofix.ymd > todayYmd) {
    return { ...empty, state: 'before-biofix', reached: false, next: firstNext };
  }
  if (!accumulation || accumulation.throughYmd === null) {
    return { ...empty, state: 'no-data', reached: 'unknown', next: null };
  }
  const total = accumulation.totalLowerBound;
  const gaps = accumulation.missingDays > 0;
  let stage: PestModelStage | null = null;
  for (const s of stages) if (s.gddFrom <= total) stage = s;
  const inWindow = stage !== null && (stage.gddTo === undefined || total <= stage.gddTo);
  const upcoming = stages.find((s) => s.gddFrom > total) ?? null;
  return {
    state: 'counting',
    stage,
    inWindow,
    reached: stage !== null ? true : gaps ? 'unknown' : false,
    next: upcoming
      ? { stage: upcoming, remaining: Math.ceil(upcoming.gddFrom - total), uncertain: gaps }
      : null,
    total,
    missingDays: accumulation.missingDays,
    throughYmd: accumulation.throughYmd
  };
}

/** Within this many degree days of the next stage, the strip starts showing it. */
export const SHOW_AHEAD_DEGREE_DAYS = 100;

/** The /scout strip shows a model when a stage is active or the next one is close,
 *  or when the grower has to act before a count can start. */
export function showOnScout(status: ModelStatus): boolean {
  if (status.state === 'no-biofix') return true;
  if (status.inWindow) return true;
  return status.next !== null && status.next.remaining <= SHOW_AHEAD_DEGREE_DAYS;
}

/** The /today card shows only models inside an active stage window. */
export function showOnToday(status: ModelStatus): boolean {
  return status.state === 'counting' && status.inWindow;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-27" → "Sep 27"; in `locale` when one is given. */
export function shortDay(ymd: string, locale?: string | null): string {
  if (locale && locale !== 'en') return formatCalendarDate(ymd, 'month-day', {}, locale);
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function totalLine(
  status: ModelStatus,
  biofix: ResolvedBiofix,
  locale?: string | null
): string | null {
  if (status.state !== 'counting' || !status.throughYmd || !biofix.ymd) return null;
  const n = Math.floor(status.total);
  const params = {
    total: t(locale, 'advice.dd.line.degreeDays', { count: n }),
    since: shortDay(biofix.ymd, locale),
    through: shortDay(status.throughYmd, locale)
  };
  if (status.missingDays > 0) {
    return t(locale, 'advice.dd.line.totalMissing', {
      ...params,
      missing: t(locale, 'advice.dd.line.days', { count: status.missingDays })
    });
  }
  return t(locale, 'advice.dd.line.total', params);
}

/** Plain lines for the strip and the card. Stage labels and messages come
 *  from the plugin and stay as written. */
export function watchForLines(
  status: ModelStatus,
  biofix: ResolvedBiofix,
  locale?: string | null
): string[] {
  if (status.state === 'no-biofix') {
    return [t(locale, 'advice.dd.line.setTraps')];
  }
  if (status.state === 'before-biofix' && biofix.ymd) {
    return [t(locale, 'advice.dd.line.startsOn', { day: shortDay(biofix.ymd, locale) })];
  }
  if (status.state === 'no-data' && biofix.ymd) {
    return [t(locale, 'advice.dd.line.noReadings', { day: shortDay(biofix.ymd, locale) })];
  }
  const lines: string[] = [];
  const total = totalLine(status, biofix, locale);
  if (total) lines.push(total);
  if (status.stage && status.inWindow) {
    lines.push(`${status.stage.label}: ${status.stage.message}`);
  }
  if (status.next) {
    const label = status.next.stage.label;
    lines.push(
      status.next.uncertain
        ? t(locale, 'advice.dd.line.cantTell', {
            label,
            missing: t(locale, 'advice.dd.line.days', { count: status.missingDays })
          })
        : t(locale, 'advice.dd.line.inAbout', {
            label,
            remaining: t(locale, 'advice.dd.line.degreeDays', { count: status.next.remaining })
          })
    );
  } else if (status.stage && !status.inWindow) {
    lines.push(t(locale, 'advice.dd.line.passed', { label: status.stage.label }));
  }
  return lines;
}

/** Plantings this year in one of the model's host families. */
export function modelApplies(
  model: Pick<PestModelPlugin, 'hostCropFamilies'>,
  plantedFamilies: ReadonlySet<string>
): boolean {
  return model.hostCropFamilies.some((f) => plantedFamilies.has(f));
}
