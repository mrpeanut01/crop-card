/**
 * Per-Owner per-year season setup (Phase 21 / UC-42).
 *
 * Six-question form captured at the start of `/plan` and persisted forever.
 * Downstream consumers (Phase 21 inputs planner; AI refinement layer) read
 * this to filter products by `philosophy`, gate weed / pest spray emissions
 * by `weedStrategy` / `pestStrategy`, and pick fertility products by
 * `fertilityApproach`.
 *
 * Storage: one row per field in the existing `appSettings` table, keyed
 * `season_setup.<year>.<field>`. Tenant scoping is automatic via
 * `getSetting` / `setSetting` (Phase 18a). No migration.
 *
 * Year-keyed because a farm's philosophy changes — an operator may run
 * conventional in 2026 and transition to organic in 2027. `carryForward`
 * supports the dominant case (this year ≈ last year, one click).
 */

import { getSetting, setSetting } from '$lib/db/settings';

export const SEASON_SETUP_FIELDS = [
  'philosophy',
  'weedStrategy',
  'pestStrategy',
  'fertilityApproach',
  'coverCropIntent',
  'sprayCapacity',
  'transitioningStartedYear',
  'setAt'
] as const;

export type SeasonSetupField = (typeof SEASON_SETUP_FIELDS)[number];

export type Philosophy =
  | 'conventional'
  | 'non-gmo'
  | 'organic-transitioning'
  | 'certified-organic';

export type WeedStrategy =
  | 'cultivate-first'
  | 'pre-emergence-ok'
  | 'post-emergence-ok'
  | 'no-spray';

export type PestStrategy = 'preventive' | 'ipm' | 'minimal' | 'no-spray';

export type FertilityApproach =
  | 'synthetic'
  | 'compost-amendments'
  | 'cover-crop-credits'
  | 'mixed';

export type CoverCropIntent = 'fall-cereal' | 'vetch-clover' | 'other' | 'none';

export type SprayCapacity =
  | 'backpack-4gal'
  | 'handheld-25gal'
  | 'boom-25-plus'
  | 'none';

export interface SeasonSetup {
  philosophy: Philosophy;
  weedStrategy: WeedStrategy;
  pestStrategy: PestStrategy;
  fertilityApproach: FertilityApproach;
  coverCropIntent: CoverCropIntent;
  sprayCapacity: SprayCapacity;
  /** Only populated when `philosophy === 'organic-transitioning'`. */
  transitioningStartedYear: number | null;
  /** The planting year this setup describes (e.g. 2026). */
  year: number;
  /** Epoch ms when this setup was last saved. */
  setAt: number;
}

/** Defaults applied when the operator hasn't set the field yet. Chosen to
 *  match the conventional small-plot baseline so a never-completed setup
 *  still produces a sensible (if generic) plan. */
export const SEASON_SETUP_DEFAULTS: Omit<SeasonSetup, 'year' | 'setAt'> = {
  philosophy: 'conventional',
  weedStrategy: 'post-emergence-ok',
  pestStrategy: 'ipm',
  fertilityApproach: 'mixed',
  coverCropIntent: 'none',
  sprayCapacity: 'backpack-4gal',
  transitioningStartedYear: null
};

const PHILOSOPHY_VALUES: readonly Philosophy[] = [
  'conventional',
  'non-gmo',
  'organic-transitioning',
  'certified-organic'
];
const WEED_VALUES: readonly WeedStrategy[] = [
  'cultivate-first',
  'pre-emergence-ok',
  'post-emergence-ok',
  'no-spray'
];
const PEST_VALUES: readonly PestStrategy[] = [
  'preventive',
  'ipm',
  'minimal',
  'no-spray'
];
const FERTILITY_VALUES: readonly FertilityApproach[] = [
  'synthetic',
  'compost-amendments',
  'cover-crop-credits',
  'mixed'
];
const COVER_VALUES: readonly CoverCropIntent[] = [
  'fall-cereal',
  'vetch-clover',
  'other',
  'none'
];
const SPRAY_VALUES: readonly SprayCapacity[] = [
  'backpack-4gal',
  'handheld-25gal',
  'boom-25-plus',
  'none'
];

function settingKey(year: number, field: SeasonSetupField): string {
  return `season_setup.${year}.${field}`;
}

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

function parseTransitioningYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1900 || n > 3000) return null;
  return n;
}

/** Load the saved setup for `year`. Returns null when the operator has
 *  never completed the form for that year — callers SHOULD distinguish
 *  "never set" from "set but uses defaults" because the canonical UI path
 *  prompts the form on null. The `philosophy` key is the canary; if it's
 *  absent, we treat the whole setup as absent rather than synthesizing
 *  defaults that the operator never confirmed. */
export function loadSeasonSetup(year: number): SeasonSetup | null {
  const philosophyRaw = getSetting(settingKey(year, 'philosophy'));
  if (!philosophyRaw) return null;

  const setAtRaw = getSetting(settingKey(year, 'setAt'));
  const setAt = setAtRaw ? Number.parseInt(setAtRaw, 10) : Date.now();

  return {
    philosophy: parseEnum(
      philosophyRaw,
      PHILOSOPHY_VALUES,
      SEASON_SETUP_DEFAULTS.philosophy
    ),
    weedStrategy: parseEnum(
      getSetting(settingKey(year, 'weedStrategy')),
      WEED_VALUES,
      SEASON_SETUP_DEFAULTS.weedStrategy
    ),
    pestStrategy: parseEnum(
      getSetting(settingKey(year, 'pestStrategy')),
      PEST_VALUES,
      SEASON_SETUP_DEFAULTS.pestStrategy
    ),
    fertilityApproach: parseEnum(
      getSetting(settingKey(year, 'fertilityApproach')),
      FERTILITY_VALUES,
      SEASON_SETUP_DEFAULTS.fertilityApproach
    ),
    coverCropIntent: parseEnum(
      getSetting(settingKey(year, 'coverCropIntent')),
      COVER_VALUES,
      SEASON_SETUP_DEFAULTS.coverCropIntent
    ),
    sprayCapacity: parseEnum(
      getSetting(settingKey(year, 'sprayCapacity')),
      SPRAY_VALUES,
      SEASON_SETUP_DEFAULTS.sprayCapacity
    ),
    transitioningStartedYear: parseTransitioningYear(
      getSetting(settingKey(year, 'transitioningStartedYear'))
    ),
    year,
    setAt
  };
}

/** Save a partial update for `year`. Missing fields fall back to the
 *  current saved value (if any), then to `SEASON_SETUP_DEFAULTS`. Always
 *  writes all six core fields + `setAt` so a subsequent `loadSeasonSetup`
 *  returns a complete, non-null record. */
export function saveSeasonSetup(
  year: number,
  input: Partial<Omit<SeasonSetup, 'year' | 'setAt'>>
): SeasonSetup {
  const current = loadSeasonSetup(year);
  const base: Omit<SeasonSetup, 'year' | 'setAt'> = current
    ? {
        philosophy: current.philosophy,
        weedStrategy: current.weedStrategy,
        pestStrategy: current.pestStrategy,
        fertilityApproach: current.fertilityApproach,
        coverCropIntent: current.coverCropIntent,
        sprayCapacity: current.sprayCapacity,
        transitioningStartedYear: current.transitioningStartedYear
      }
    : { ...SEASON_SETUP_DEFAULTS };

  const merged = { ...base, ...input };

  setSetting(settingKey(year, 'philosophy'), merged.philosophy);
  setSetting(settingKey(year, 'weedStrategy'), merged.weedStrategy);
  setSetting(settingKey(year, 'pestStrategy'), merged.pestStrategy);
  setSetting(settingKey(year, 'fertilityApproach'), merged.fertilityApproach);
  setSetting(settingKey(year, 'coverCropIntent'), merged.coverCropIntent);
  setSetting(settingKey(year, 'sprayCapacity'), merged.sprayCapacity);

  if (
    merged.philosophy === 'organic-transitioning' &&
    merged.transitioningStartedYear !== null
  ) {
    setSetting(
      settingKey(year, 'transitioningStartedYear'),
      String(merged.transitioningStartedYear)
    );
  } else {
    // Clear when philosophy is anything else so the conditional field
    // never lingers after a change away from 'organic-transitioning'.
    setSetting(settingKey(year, 'transitioningStartedYear'), '');
  }

  const setAt = Date.now();
  setSetting(settingKey(year, 'setAt'), String(setAt));

  return {
    ...merged,
    transitioningStartedYear:
      merged.philosophy === 'organic-transitioning'
        ? merged.transitioningStartedYear
        : null,
    year,
    setAt
  };
}

/** Copy `fromYear`'s setup into `toYear` with a refreshed `setAt`. Returns
 *  null when `fromYear` has nothing saved — caller should fall through to
 *  the empty form. Does NOT overwrite an existing `toYear` setup (if the
 *  operator already started one). */
export function carryForward(fromYear: number, toYear: number): SeasonSetup | null {
  if (fromYear === toYear) return loadSeasonSetup(toYear);
  if (loadSeasonSetup(toYear)) return loadSeasonSetup(toYear);
  const source = loadSeasonSetup(fromYear);
  if (!source) return null;
  return saveSeasonSetup(toYear, {
    philosophy: source.philosophy,
    weedStrategy: source.weedStrategy,
    pestStrategy: source.pestStrategy,
    fertilityApproach: source.fertilityApproach,
    coverCropIntent: source.coverCropIntent,
    sprayCapacity: source.sprayCapacity,
    transitioningStartedYear: source.transitioningStartedYear
  });
}

/** True when the setup demands NOP-compliant products only. Drives the
 *  philosophy filter in `lib/season/philosophyFilter.ts` (B-25). */
export function isOrganicCompliant(s: SeasonSetup): boolean {
  return s.philosophy === 'certified-organic' || s.philosophy === 'organic-transitioning';
}

/** True when synthetic fertilizers / herbicides / insecticides are
 *  permitted. The inverse of `isOrganicCompliant` for the two terminal
 *  philosophies; the transitioning case is conservative (treated as
 *  organic). */
export function allowsSynthetics(s: SeasonSetup): boolean {
  return s.philosophy === 'conventional' || s.philosophy === 'non-gmo';
}

/** Compact human-readable summary used by `SeasonSetupChip.svelte`.
 *  Example: "Organic · IPM · Compost-first · Backpack ≤4 gal · Cover: vetch · 2026" */
export function summarizeSeasonSetup(s: SeasonSetup): string {
  const phil = PHILOSOPHY_LABELS[s.philosophy];
  const pest = PEST_LABELS[s.pestStrategy];
  const fert = FERTILITY_LABELS[s.fertilityApproach];
  const cap = SPRAY_LABELS[s.sprayCapacity];
  const cover =
    s.coverCropIntent === 'none' ? null : `Cover: ${COVER_LABELS[s.coverCropIntent]}`;
  return [phil, pest, fert, cap, cover, s.year].filter(Boolean).join(' · ');
}

// ─── Human-readable labels (for chip + select options) ──────────────────

export const PHILOSOPHY_LABELS: Record<Philosophy, string> = {
  conventional: 'Conventional',
  'non-gmo': 'Non-GMO',
  'organic-transitioning': 'Organic (transitioning)',
  'certified-organic': 'Certified organic'
};

export const WEED_LABELS: Record<WeedStrategy, string> = {
  'cultivate-first': 'Cultivate first',
  'pre-emergence-ok': 'Pre-emergence OK',
  'post-emergence-ok': 'Post-emergence OK',
  'no-spray': 'No spray'
};

export const PEST_LABELS: Record<PestStrategy, string> = {
  preventive: 'Preventive',
  ipm: 'IPM (scout-then-spray)',
  minimal: 'Minimal',
  'no-spray': 'No spray'
};

export const FERTILITY_LABELS: Record<FertilityApproach, string> = {
  synthetic: 'Synthetic NPK',
  'compost-amendments': 'Compost & amendments',
  'cover-crop-credits': 'Cover-crop credits',
  mixed: 'Mixed'
};

export const COVER_LABELS: Record<CoverCropIntent, string> = {
  'fall-cereal': 'Fall cereal rye',
  'vetch-clover': 'Vetch / clover',
  other: 'Other',
  none: 'None'
};

export const SPRAY_LABELS: Record<SprayCapacity, string> = {
  'backpack-4gal': 'Backpack ≤4 gal',
  'handheld-25gal': 'Handheld ≤25 gal',
  'boom-25-plus': 'Boom 25+ gal',
  none: 'None'
};
