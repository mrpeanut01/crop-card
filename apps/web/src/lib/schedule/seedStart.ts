/**
 * Phase 32E (E1) seed starting. Pure and client-safe.
 *
 * Every step backs off from the planting's in-ground date
 * (`crops.planting_date`), never from a frost date (ruling E1-3), so a fall
 * brassica transplanted in August backs off from August whatever shape the
 * frost season has. A timing value comes from the owner, then the sourced
 * plugin, then a sourced family fallback; otherwise it is not known and its
 * step is left out (E1-5).
 */

import { t } from '$lib/i18n';
import { familySeedStartDefaults } from '$lib/plugins/familyDefaults';

export type SeedStartStep = 'sow' | 'harden' | 'transplant';
export type TimingSource = 'manual' | 'plugin' | 'fallback';
export type Establishment = 'direct-seed' | 'transplant';

export const SEED_START_STEPS: readonly SeedStartStep[] = ['sow', 'harden', 'transplant'];

export interface SeedStartTiming {
  startIndoorsWeeks: { min: number; max: number; source: TimingSource } | null;
  hardenOffDays: { min: number; max: number; source: TimingSource } | null;
}

export interface SeedStartPlan {
  inGroundMs: number;
  steps: Array<{ step: SeedStartStep; dateMs: number; source: TimingSource }>;
  /** Steps left out because timing is not known. */
  unknown: Array<'sow' | 'harden'>;
  /** The typed sow date was on or after the in-ground date, so it was not used. */
  sowAfterTransplant?: boolean;
}

export const SOW_AFTER_TRANSPLANT_NOTE =
  'The sow date you typed is on or after the transplant date, so it was not used. Pick a day before the transplant.';

export const DAY_MS = 86_400_000;

export const SOW_TIMING_UNKNOWN =
  'Indoor start timing is not known for this crop. Set the sow date yourself.';
export const HARDEN_TIMING_UNKNOWN = 'Harden off first. Timing is not known for this crop.';
export const PAST_START_BODY = "You're past the usual start. Sow now or buy seedlings.";
export const DTM_FROM_TRANSPLANT_NOTE =
  'Days to maturity count from transplant, so seeded in the ground it will be later.';

/** The slice of a crop plugin seed starting reads. `CropPlugin`,
 *  `GardenCrop` and the offline `SnapshotCropPlugin` all satisfy it. */
export interface SeedStartPluginSlice {
  cropFamily?: string;
  plantingGuide?: {
    startIndoorsWeeks?: { min: number; max: number };
    hardenOffDays?: { min: number; max: number };
    establishment?: 'direct-seed' | 'transplant' | 'either';
    dtmFrom?: 'direct-seed' | 'transplant';
    transplantOffsetDays?: number;
  };
}
type GuideSlice = SeedStartPluginSlice;

function validRange(
  r: { min: number; max: number } | undefined
): r is { min: number; max: number } {
  return !!r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min >= 0 && r.max >= r.min;
}

export function resolveSeedStartTiming(
  plugin: GuideSlice,
  overrides?: { sowIndoorsOnMs?: number }
): SeedStartTiming {
  const guide = plugin.plantingGuide ?? {};
  const family = familySeedStartDefaults(plugin.cropFamily);
  let startIndoorsWeeks: SeedStartTiming['startIndoorsWeeks'] = null;
  if (validRange(guide.startIndoorsWeeks)) {
    startIndoorsWeeks = { ...guide.startIndoorsWeeks, source: 'plugin' };
  } else if (validRange(family.startIndoorsWeeks)) {
    startIndoorsWeeks = { ...family.startIndoorsWeeks, source: 'fallback' };
  }
  let hardenOffDays: SeedStartTiming['hardenOffDays'] = null;
  if (validRange(guide.hardenOffDays)) {
    hardenOffDays = { ...guide.hardenOffDays, source: 'plugin' };
  } else if (validRange(family.hardenOffDays)) {
    hardenOffDays = { ...family.hardenOffDays, source: 'fallback' };
  }
  if (overrides?.sowIndoorsOnMs !== undefined && startIndoorsWeeks) {
    startIndoorsWeeks = { ...startIndoorsWeeks, source: 'manual' };
  }
  return { startIndoorsWeeks, hardenOffDays };
}

/** Days before transplant to sow: the midpoint of the weeks range. */
export function sowLeadDays(weeks: { min: number; max: number }): number {
  return Math.round(((weeks.min + weeks.max) / 2) * 7);
}

export function seedStartPlan(
  inGroundMs: number,
  timing: SeedStartTiming,
  overrides?: { sowIndoorsOnMs?: number }
): SeedStartPlan {
  const steps: SeedStartPlan['steps'] = [];
  const unknown: SeedStartPlan['unknown'] = [];
  const typedSow =
    overrides?.sowIndoorsOnMs !== undefined && Number.isFinite(overrides.sowIndoorsOnMs)
      ? overrides.sowIndoorsOnMs
      : undefined;
  const sowAfterTransplant = typedSow !== undefined && typedSow >= inGroundMs;
  const sowOverride = sowAfterTransplant ? undefined : typedSow;
  if (sowOverride !== undefined) {
    steps.push({ step: 'sow', dateMs: sowOverride, source: 'manual' });
  } else if (timing.startIndoorsWeeks) {
    steps.push({
      step: 'sow',
      dateMs: inGroundMs - sowLeadDays(timing.startIndoorsWeeks) * DAY_MS,
      source: timing.startIndoorsWeeks.source
    });
  } else {
    unknown.push('sow');
  }
  if (timing.hardenOffDays) {
    steps.push({
      step: 'harden',
      dateMs: inGroundMs - Math.round(timing.hardenOffDays.max) * DAY_MS,
      source: timing.hardenOffDays.source
    });
  } else {
    unknown.push('harden');
  }
  steps.push({ step: 'transplant', dateMs: inGroundMs, source: 'plugin' });
  return sowAfterTransplant
    ? { inGroundMs, steps, unknown, sowAfterTransplant }
    : { inGroundMs, steps, unknown };
}

export function seedStartTaskId(cropId: string, step: SeedStartStep): string {
  return `tk_seed_${cropId}_${step}`;
}

export function seedStartTemplateKey(cropId: string, step: SeedStartStep): string {
  return `seedstart:${cropId}:${step}`;
}

export function isSeedStartTemplateKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith('seedstart:');
}

export function seedStartStepOf(key: string | null | undefined): SeedStartStep | null {
  if (!isSeedStartTemplateKey(key)) return null;
  const step = key!.slice(key!.lastIndexOf(':') + 1);
  return (SEED_START_STEPS as readonly string[]).includes(step) ? (step as SeedStartStep) : null;
}

function weeksText(w: { min: number; max: number }): string {
  return w.min === w.max ? `${w.min} weeks` : `${w.min} to ${w.max} weeks`;
}

function daysText(d: { min: number; max: number }): string {
  return d.min === d.max ? `${d.min} days` : `${d.min} to ${d.max} days`;
}

/** Title and body of one seed-start task (E1-8, E1-9). */
export function seedStartTaskText(input: {
  step: SeedStartStep;
  cropName: string;
  bedName: string;
  timing: SeedStartTiming;
  dateMs: number;
  nowMs: number;
  sowManual?: boolean;
}): { title: string; body: string } {
  const { step, cropName, bedName, timing } = input;
  const late = input.dateMs < startOfUtcDay(input.nowMs);
  if (step === 'sow') {
    const lines: string[] = [];
    if (input.sowManual) lines.push('You set this sow date.');
    else if (timing.startIndoorsWeeks) {
      lines.push(`Sow ${weeksText(timing.startIndoorsWeeks)} before transplant.`);
    }
    if (late) lines.push(PAST_START_BODY);
    return { title: `Sow ${cropName} indoors`, body: lines.join(' ') };
  }
  if (step === 'harden') {
    const lines: string[] = [];
    if (timing.hardenOffDays) {
      lines.push(
        `Set the seedlings outside a little longer each day for ${daysText(timing.hardenOffDays)} before transplant.`
      );
    }
    return { title: `Start hardening off ${cropName}`, body: lines.join(' ') };
  }
  return {
    title: `Transplant ${cropName} to ${bedName}`,
    body: timing.hardenOffDays ? '' : HARDEN_TIMING_UNKNOWN
  };
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** What days to maturity count from (E1-11). The in-ground date, except a
 *  transplant whose plugin counts from seeding and whose indoor sowing is
 *  on record: then the indoor sowing. */
export function maturityStartMs(
  crop: {
    plantingDate: number | null;
    establishment: Establishment | null;
    sownIndoorsAt: number | null;
  },
  plugin: { plantingGuide?: { dtmFrom?: 'direct-seed' | 'transplant' } } | undefined
): number | null {
  if (
    crop.establishment === 'transplant' &&
    plugin?.plantingGuide?.dtmFrom === 'direct-seed' &&
    crop.sownIndoorsAt != null &&
    Number.isFinite(crop.sownIndoorsAt)
  ) {
    return crop.sownIndoorsAt;
  }
  return crop.plantingDate;
}

/** True when a direct-seeded crop's days to maturity count from transplant,
 *  so the grower sees the note instead of a shifted date. */
export function dtmCountsFromTransplantNote(
  establishment: Establishment | null,
  plugin: { plantingGuide?: { dtmFrom?: 'direct-seed' | 'transplant' } } | undefined
): boolean {
  return establishment === 'direct-seed' && plugin?.plantingGuide?.dtmFrom === 'transplant';
}

/** The answer the planting form preselects (E1-2). */
export function preselectedEstablishment(plugin: GuideSlice | undefined): Establishment | null {
  const e = plugin?.plantingGuide?.establishment;
  return e === 'direct-seed' || e === 'transplant' ? e : null;
}

/** Spring transplant date to prefill an undated planting (E1-4): last
 *  spring frost plus the plugin's sourced offset, clamped into the planting
 *  window when one is given. Null when the offset is not known. */
export function suggestedTransplantMs(
  plugin: GuideSlice,
  lastSpringFrostMs: number | null,
  window?: { startMs: number; endMs: number } | null
): number | null {
  const offset = plugin.plantingGuide?.transplantOffsetDays;
  if (lastSpringFrostMs == null || typeof offset !== 'number' || !Number.isFinite(offset)) {
    return null;
  }
  let ms = lastSpringFrostMs + offset * DAY_MS;
  if (window && window.endMs >= window.startMs) {
    ms = Math.min(Math.max(ms, window.startMs), window.endMs);
  }
  return ms;
}

/** Germination count bound (E1-15). */
export function germinationMax(cells: number | null, seedsPerCell: number | null): number {
  return cells != null && seedsPerCell != null && cells > 0 && seedsPerCell > 0
    ? cells * seedsPerCell
    : 10_000;
}

export function germinationText(
  count: number | null,
  cells: number | null,
  seedsPerCell: number | null,
  locale?: string | null
): string {
  const up = count ?? 0;
  if (cells != null && cells > 0) {
    const planted = seedsPerCell != null && seedsPerCell > 0 ? cells * seedsPerCell : cells;
    return t(locale, 'sched.germOf', { up, planted });
  }
  return t(locale, 'sched.germUp', { up });
}

/** The planting request fields for a "Seed or seedling?" answer. Nothing
 *  picked sends nothing, which keeps today's behavior (E1-2). */
export function establishmentPayload(
  establishment: Establishment | null,
  startIndoors: boolean,
  sowIndoorsOnYmd?: string
): { establishment?: Establishment; startIndoors?: boolean; sowIndoorsOn?: number } {
  if (!establishment) return {};
  if (establishment === 'direct-seed') return { establishment };
  const out: { establishment: Establishment; startIndoors: boolean; sowIndoorsOn?: number } = {
    establishment,
    startIndoors
  };
  if (startIndoors && sowIndoorsOnYmd) {
    const ms = Date.parse(`${sowIndoorsOnYmd}T00:00:00Z`);
    if (Number.isFinite(ms)) out.sowIndoorsOn = ms;
  }
  return out;
}

/** The seed-start slice of a plugin's planting guide, or undefined when it
 *  has none, so page payloads stay small. */
export function seedStartGuide(
  plugin: SeedStartPluginSlice
): SeedStartPluginSlice['plantingGuide'] {
  const g = plugin.plantingGuide;
  if (!g) return undefined;
  const out: NonNullable<SeedStartPluginSlice['plantingGuide']> = {};
  if (g.establishment) out.establishment = g.establishment;
  if (g.startIndoorsWeeks) out.startIndoorsWeeks = g.startIndoorsWeeks;
  if (g.hardenOffDays) out.hardenOffDays = g.hardenOffDays;
  if (g.dtmFrom) out.dtmFrom = g.dtmFrom;
  if (g.transplantOffsetDays !== undefined) out.transplantOffsetDays = g.transplantOffsetDays;
  return Object.keys(out).length ? out : undefined;
}
