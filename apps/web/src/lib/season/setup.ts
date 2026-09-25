/**
 * Per-Owner per-year season setup — TYPES + PURE HELPERS (Phase 21 / UC-42).
 *
 * SAFE TO IMPORT FROM ANY CONTEXT (client / server / tests). The DB-backed
 * read/write functions live in the sibling `setup.server.ts` so they don't
 * leak `better-sqlite3` into the client bundle.
 *
 * Five-question form captured at the start of `/plan` and persisted forever.
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
  'transitioningStartedYear',
  'setAt'
] as const;

export type SeasonSetupField = (typeof SEASON_SETUP_FIELDS)[number];

export type Philosophy =
  'conventional' | 'no-till' | 'non-gmo' | 'organic-transitioning' | 'certified-organic';

export type WeedStrategy = 'cultivate-first' | 'pre-emergence-ok' | 'post-emergence-ok';

export type PestStrategy = 'preventive' | 'ipm' | 'minimal';

export type FertilityApproach = 'synthetic' | 'compost-amendments' | 'cover-crop-credits' | 'mixed';

export type CoverCropIntent = 'fall-cereal' | 'vetch-clover' | 'other' | 'none';

export interface SeasonSetup {
  philosophy: Philosophy;
  weedStrategy: WeedStrategy;
  pestStrategy: PestStrategy;
  fertilityApproach: FertilityApproach;
  /** The cover crop grown over the prior winter, terminated ahead of this
   *  season's planting. Drives the spring termination task and the flat
   *  N credit under the cover-crop-credits fertility approach. The key keeps
   *  its original name so saved setups load unchanged. */
  coverCropIntent: CoverCropIntent;
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
  transitioningStartedYear: null
};

export const PHILOSOPHY_VALUES: readonly Philosophy[] = [
  'conventional',
  'no-till',
  'non-gmo',
  'organic-transitioning',
  'certified-organic'
];
export const WEED_VALUES: readonly WeedStrategy[] = [
  'cultivate-first',
  'pre-emergence-ok',
  'post-emergence-ok'
];
/** Order is least-spray → most-spray to mirror the WEED_VALUES tier
 *  pattern. Dropdown rendering iterates `Object.entries(PEST_LABELS)`,
 *  so the order in PEST_LABELS is what the operator actually sees. */
export const PEST_VALUES: readonly PestStrategy[] = ['minimal', 'ipm', 'preventive'];
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
  return (
    s.philosophy === 'conventional' || s.philosophy === 'no-till' || s.philosophy === 'non-gmo'
  );
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
 *  · Cover: Vetch / clover · 2026" */
export function summarizeSeasonSetup(s: SeasonSetup): string {
  const phil = chipForm(PHILOSOPHY_LABELS[s.philosophy]);
  const pest = chipForm(PEST_LABELS[s.pestStrategy]);
  const fert = chipForm(FERTILITY_LABELS[s.fertilityApproach]);
  const cover = s.coverCropIntent === 'none' ? null : `Cover: ${COVER_LABELS[s.coverCropIntent]}`;
  return [phil, pest, fert, cover, s.year].filter(Boolean).join(' · ');
}

// ─── Human-readable labels (for chip + select options) ──────────────────

export const PHILOSOPHY_LABELS: Record<Philosophy, string> = {
  conventional: 'Conventional',
  'no-till': 'No-till — burndown and residue management instead of tillage',
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
  'pre-emergence-ok': '+ Pre-emergence — early-season herbicide for known weed pressure',
  'post-emergence-ok': '+ Post-emergence — in-season herbicide for breakthrough weeds'
};

/**
 * Plain-language labels (Phase 21a polish, 2026-05-17): "IPM" is
 * agronomic jargon — operators reading the dropdown for the first time
 * don't necessarily know it stands for "Integrated Pest Management."
 * Restate as "Scout-then-spray." Ordered least-spray → most-spray to
 * mirror the WEED_LABELS tier pattern; key-insertion order drives the
 * dropdown render order via Object.entries.
 */
export const PEST_LABELS: Record<PestStrategy, string> = {
  minimal: 'Minimal — spray only on severe outbreaks',
  ipm: 'Scout-then-spray — check fields first, spray only if pests cross a threshold',
  preventive: 'Preventive — scheduled sprays on a calendar'
};

/**
 * Plain-language labels (Phase 21a polish, 2026-05-17): "NPK" is
 * agronomic shorthand for the nitrogen-phosphorus-potassium analysis
 * on a fertilizer bag (the three numbers like 10-10-10). Operators new
 * to the term won't decode it from "Synthetic NPK." Restate around
 * recognizable products instead — `10-10-10` and `urea` are the labels
 * a small-plot operator actually sees at the farm store.
 */
export const FERTILITY_LABELS: Record<FertilityApproach, string> = {
  synthetic: 'Bagged synthetic fertilizer — e.g., 10-10-10, urea, ammonium nitrate',
  'compost-amendments': 'Compost, manure & natural amendments',
  'cover-crop-credits': 'Cover-crop nitrogen credits — lean on legume cover from prior season',
  mixed: 'Mix of the above — pick whichever fits each field'
};

export const COVER_LABELS: Record<CoverCropIntent, string> = {
  'fall-cereal': 'Fall cereal rye',
  'vetch-clover': 'Vetch / clover',
  other: 'Other',
  none: 'None'
};
