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
  | 'post-emergence-ok';

export type PestStrategy = 'preventive' | 'ipm' | 'minimal';

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
  'post-emergence-ok'
];
export const PEST_VALUES: readonly PestStrategy[] = ['preventive', 'ipm', 'minimal'];
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

/** Strip the explanatory tail from a label so the compact chip fits on a
 *  phone screen. Labels with the shape "Short — long explanation" get the
 *  short part only. Labels without " — " are returned as-is. */
function chipForm(label: string): string {
  const i = label.indexOf(' — ');
  return i === -1 ? label : label.slice(0, i);
}

/** Compact human-readable summary used by `SeasonSetupChip.svelte`.
 *  Example: "Certified organic · Scout-then-spray · Compost & amendments
 *  · Backpack ≤4 gal · Cover: Vetch / clover · 2026" */
export function summarizeSeasonSetup(s: SeasonSetup): string {
  const phil = chipForm(PHILOSOPHY_LABELS[s.philosophy]);
  const pest = chipForm(PEST_LABELS[s.pestStrategy]);
  const fert = chipForm(FERTILITY_LABELS[s.fertilityApproach]);
  const cap = chipForm(SPRAY_LABELS[s.sprayCapacity]);
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
 * methods of the tier above. A `post-emergence-ok` operator is also OK
 * with pre-emergence and cultivation. The `+ …` prefix on tiers 2 and 3
 * telegraphs accumulation in the dropdown without forcing a multi-select
 * form. The former `no-spray` option was dropped — it was redundant with
 * `cultivate-first` for operator intent (both mean "no herbicides"); an
 * operator who mulches instead of cultivating just ignores the planner's
 * cultivation reminders.
 */
export const WEED_LABELS: Record<WeedStrategy, string> = {
  'cultivate-first': 'No herbicides — cultivation / mulch / hand-weed',
  'pre-emergence-ok':
    '+ Pre-emergence — early-season herbicide for known weed pressure',
  'post-emergence-ok':
    '+ Post-emergence — in-season herbicide for breakthrough weeds'
};

/**
 * Plain-language labels (Phase 21a polish, 2026-05-17): "IPM" is
 * agronomic jargon — operators reading the dropdown for the first time
 * don't necessarily know it stands for "Integrated Pest Management."
 * Restate as "Scout, then spray if needed." Dropped `no-spray` (was
 * redundant with `minimal`).
 */
export const PEST_LABELS: Record<PestStrategy, string> = {
  preventive: 'Preventive — scheduled sprays on a calendar',
  ipm: 'Scout-then-spray — check fields first, spray only if pests cross a threshold',
  minimal: 'Minimal — spray only on severe outbreaks'
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
