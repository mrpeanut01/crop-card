/**
 * Per-Owner per-year season setup — TYPES + PURE HELPERS (Phase 21 / UC-42).
 *
 * SAFE TO IMPORT FROM ANY CONTEXT (client / server / tests). The DB-backed
 * read/write functions live in the sibling `setup.server.ts` so they don't
 * leak `better-sqlite3` into the client bundle.
 *
 * Six-question form captured at the start of `/plan` and persisted forever.
 * Downstream consumers (Phase 21 inputs planner; AI refinement layer) read
 * this to filter products by `philosophy`, gate weed / pest spray emissions
 * by `weedStrategy` / `pestStrategy`, and pick fertility products by
 * `fertilityApproach`.
 *
 * Year-keyed because a farm's philosophy changes — an operator may run
 * conventional in 2026 and transition to organic in 2027. `carryForward`
 * (in `setup.server.ts`) supports the dominant case (this year ≈ last
 * year, one click).
 */

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

export const PHILOSOPHY_VALUES: readonly Philosophy[] = [
  'conventional',
  'non-gmo',
  'organic-transitioning',
  'certified-organic'
];
export const WEED_VALUES: readonly WeedStrategy[] = [
  'cultivate-first',
  'pre-emergence-ok',
  'post-emergence-ok',
  'no-spray'
];
export const PEST_VALUES: readonly PestStrategy[] = [
  'preventive',
  'ipm',
  'minimal',
  'no-spray'
];
export const FERTILITY_VALUES: readonly FertilityApproach[] = [
  'synthetic',
  'compost-amendments',
  'cover-crop-credits',
  'mixed'
];
export const COVER_VALUES: readonly CoverCropIntent[] = [
  'fall-cereal',
  'vetch-clover',
  'other',
  'none'
];
export const SPRAY_VALUES: readonly SprayCapacity[] = [
  'backpack-4gal',
  'handheld-25gal',
  'boom-25-plus',
  'none'
];

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

/**
 * Cumulative tiers (Phase 21a polish, 2026-05-17): each tier adds the
 * methods of the tier above it. A `post-emergence-ok` operator is also
 * OK with pre-emergence and cultivation. `no-spray` is the off-ramp —
 * the operator handles weeds without planner help (mulch / hand / cover
 * crop). The `+ …` prefix on tiers 2 and 3 telegraphs accumulation in
 * the dropdown without forcing a multi-select form.
 */
export const WEED_LABELS: Record<WeedStrategy, string> = {
  'cultivate-first': 'Cultivation only — no herbicides',
  'pre-emergence-ok':
    '+ Pre-emergence — early-season herbicide for known weed pressure',
  'post-emergence-ok':
    '+ Post-emergence — in-season herbicide for breakthrough weeds',
  'no-spray': "No-spray (mulch / hand only) — I'll manage weeds without planner help"
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
