import { z } from 'zod';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import { CHEMISTRY_CLASSES } from '$lib/safety/types';

/**
 * Zod source-of-truth for plugin shapes. JSON Schemas in /schemas/ are
 * derived from these and published for plugin authors. Any change here
 * must be reflected there before release.
 */

const pluginIdRegex = /^[a-z0-9][a-z0-9-]{0,63}$/;

const pluginBase = z.object({
  pluginId: z.string().regex(pluginIdRegex, 'pluginId must be kebab-case ≤64 chars'),
  displayName: z.string().min(1).max(120),
  version: z.string().min(1)
});

/** Spacing guide values, surfaced inside the planting task view (FR-13). */
const minMaxNumber = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' });

export const plantingGuideSchema = z
  .object({
    soilTempMinF: z.number().optional(),
    rowSpacingIn: z.number().positive().optional(),
    inRowSpacingIn: minMaxNumber.optional(),
    seedDepthIn: minMaxNumber.optional(),
    seedsPerAcre: z.number().int().positive().optional(),
    recommendedLbsPerAcre: z.number().positive().optional(),
    /** v1.3 — mature vine spread in feet (cucurbits, gourds, vining berries).
     *  Used by sufficiency.footprintSqFt to size sprawling crops correctly so
     *  the AI allocator doesn't over-pack vine crops based on row spacing. */
    vineSpreadFt: minMaxNumber.optional(),
    /** v1.3 — explicit per-plant mature canopy area in sq ft. When supplied,
     *  overrides both row-spacing and vineSpreadFt-derived footprint. Use
     *  for crops with non-circular canopies or when you have a survey value. */
    matureCanopyFtSq: z.number().positive().max(2000).optional(),
    // ─── Phase 17 (Track 1) — promote engine fallbacks to plugin data ────
    /** Seed count per pound for this variety. Replaces the family-default
     *  fallback in `seed/quantity.ts`. */
    seedsPerLb: z.number().positive().optional(),
    /** Reference seeding density used by the swim-lane shade heuristic when
     *  comparing actual planted density against a "typical" rate. Replaces
     *  the FAMILY_DENSITY_REF fallback in `calendar/engine.ts`. */
    referenceDensitySeedsPerAcre: z.number().int().positive().optional(),
    /** Days from planting until visible emergence. Replaces the global
     *  `DEFAULT_EMERGENCE_DAYS = {7, 14}` fallback in `calendar/engine.ts`. */
    emergenceDays: minMaxNumber.optional()
  })
  .partial();

/** Post-harvest curing data, drives FR-08 curing reminders. */
export const postHarvestCuringSchema = z
  .object({
    method: z.string().min(1),
    durationWeeks: z
      .object({ min: z.number().int().positive(), max: z.number().int().positive() })
      .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' }),
    targetMoisturePercent: minMaxNumber.optional(),
    storageLocation: z.string().optional()
  })
  .partial({ targetMoisturePercent: true, storageLocation: true });

// ─── Plugin schema v1.1 (HCD Guide §4) — additive, optional ─────────────
//
// New crop-plugin fields supporting hay (FR-19, FR-21, FR-23) and small
// grain (FR-20) workflows. All fields are optional. Existing v1.0 plugins
// pass validation unchanged. Per CLAUDE.md invariant #1, kernel rules live
// in TypeScript; plugins declare thresholds, the kernel enforces.

export const cropOperationModelSchema = z.enum([
  'single-event',
  'multi-step',
  'perennial-multi-cut'
]);

const moistureThresholdsSchema = z.object({
  /** Below this percent → soft warning (e.g., leaf shatter on hay). */
  warnBelowPct: z.number().nonnegative().max(100).optional(),
  /** Below this percent → hard STOP. */
  dangerBelowPct: z.number().nonnegative().max(100).optional(),
  /** Above this percent → soft warning. */
  warnAbovePct: z.number().nonnegative().max(100).optional(),
  /** Above this percent → hard STOP (e.g., baled hay >22% = fire risk). */
  dangerAbovePct: z.number().nonnegative().max(100).optional(),
  /** Optimum band for the operation (display + green-state UI). */
  optimumPercent: minMaxNumber.optional()
});

/** Hay-specific multi-step operation declaration (FR-19, FR-21). */
export const hayOperationsSchema = z.object({
  steps: z
    .array(z.enum(['mow', 'ted', 'rake', 'bale', 'store']))
    .min(2)
    .default(['mow', 'rake', 'bale', 'store']),
  cuttingsPerSeason: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' })
    .optional(),
  cutIntervalDays: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' })
    .optional(),
  mowTrigger: z.string().optional(),
  weatherWindowDays: z.number().int().min(1).max(14).default(3),
  /** Per-bale-type baling thresholds. Keys are bale-type strings. */
  baleMoistureGate: z
    .record(z.enum(['small-square', 'large-round', 'large-square']), moistureThresholdsSchema)
    .optional(),
  /** Storage temperature watch — fires reminder events (FR-23 supports). */
  storageTempWatchF: z.object({ warn: z.number(), danger: z.number() }).optional()
});

/** Zadoks small-grain growth-stage table (FR-20).
 *  @deprecated Loader normalizes into `growthStageTable` with `system: 'zadoks'`. */
export const zadoksStageSchema = z.object({
  stage: z.string().regex(/^Z\d{2}(-Z\d{2})?$/, 'stage must look like Z30 or Z30-Z39'),
  name: z.string().min(1),
  daysFromPlanting: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().positive() })
    .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' })
});

// ─── Plugin schema v1.3 (growth-stage phenology) ─────────────────────────
//
// Generic per-variety growth-stage table + corn-type classifier. Unifies the
// V/R-stage knowledge previously hard-coded in the calendar engine for corn
// with Zadoks (small grains), BBCH (cucurbit/solanaceae), and simple-named
// stages (leafy/brassica/root/herb). Plugins inherit a family-default table
// from `growthStageTemplates.ts` when omitted.

export const STAGE_SYSTEMS = [
  'vr-corn',
  'r-soybean',
  'zadoks',
  'bbch',
  'simple',
  'perennial-calendar'
] as const;
export const stageSystemSchema = z.enum(STAGE_SYSTEMS);
export type StageSystem = (typeof STAGE_SYSTEMS)[number];

export const CORN_TYPES = ['sweet', 'popcorn', 'dent', 'flour', 'flint', 'dual-purpose'] as const;
export const cornTypeSchema = z.enum(CORN_TYPES);
export type CornType = (typeof CORN_TYPES)[number];

export const STAGE_BODY_KINDS = [
  'vegetative',
  'reproductive',
  'ripening',
  'dormant',
  'transition'
] as const;

export const HARVEST_USE_CASES = [
  'fresh-eating',
  'milling',
  'ornamental',
  'seed-saving',
  'silage',
  'dry-storage',
  'juicing',
  'canning'
] as const;

export const growthStageSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(80),
  daysFromPlanting: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().positive() })
    .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' }),
  inspect: z.string().max(280).optional(),
  bodyKind: z.enum(STAGE_BODY_KINDS).optional()
});
export type GrowthStage = z.infer<typeof growthStageSchema>;

export const harvestTargetSchema = z.object({
  stageCode: z.string().min(1).max(16),
  label: z.string().min(1).max(60),
  useCase: z.enum(HARVEST_USE_CASES).optional()
});
export type HarvestTarget = z.infer<typeof harvestTargetSchema>;

export const growthStageTableSchema = z
  .object({
    system: stageSystemSchema,
    referenceDtmDays: z.number().int().positive().optional(),
    stages: z
      .array(growthStageSchema)
      .min(1)
      .refine(
        (arr) => arr.every((s, i, a) => i === 0 || s.daysFromPlanting.min >= a[i - 1].daysFromPlanting.min),
        'stages must be ordered by daysFromPlanting.min ascending'
      ),
    harvestTargets: z.array(harvestTargetSchema).min(1)
  })
  .refine(
    (t) => t.harvestTargets.every((h) => t.stages.some((s) => s.code === h.stageCode)),
    'every harvestTargets[].stageCode must match a stages[].code'
  );
export type GrowthStageTable = z.infer<typeof growthStageTableSchema>;

/** Generic harvest-moisture gate for any moisture-sensitive crop (FR-21). */
export const harvestMoistureGateSchema = z.object({
  operation: z.literal('harvest'),
  thresholds: moistureThresholdsSchema
});

/**
 * Orchard-specific seasonal task templates (FR-10). Each entry fires once
 * per planting per year at the given offset from `referenceDate` (the
 * planting date is treated as the season anchor for v1; phase-9 follow-up
 * could anchor to bud-break instead).
 */
export const orchardSeasonalTaskSchema = z.object({
  key: z.enum([
    'dormant-oil',
    'pre-bloom-fungicide',
    'bloom-fungicide',
    'post-bloom-thinning',
    'summer-cover-spray',
    'pre-harvest-cover-spray',
    'harvest'
  ]),
  /** Days from January 1 of each season-year (positive int 1-366). */
  dayOfYear: z.number().int().min(1).max(366),
  windowDays: z.number().int().min(1).max(60).default(7),
  title: z.string().min(1),
  body: z.string().optional()
});

/**
 * Generic seasonal task — works for any crop family (Phase 9 generalization
 * of orchardSeasonalTasks). Either `dayOfYear` (calendar-anchored, perennials)
 * or `daysAfterPlanting` (relative, annuals) drives the start time.
 * Perennial families (orchard, stone-fruit, small-fruit, bramble, vine-fruit,
 * forage) render across multiple calendar years; annuals render once.
 */
export const seasonalTaskSchema = z
  .object({
    key: z.string().min(1).max(80),
    kind: z
      .enum([
        'spray',
        'cultural',
        'pruning',
        'thinning',
        'fertilize',
        'irrigate',
        'scout',
        'harvest'
      ])
      .default('cultural'),
    dayOfYear: z.number().int().min(1).max(366).optional(),
    daysAfterPlanting: z.number().int().min(0).max(3650).optional(),
    windowDays: z.number().int().min(1).max(120).default(7),
    title: z.string().min(1),
    body: z.string().optional()
  })
  .refine((v) => v.dayOfYear !== undefined || v.daysAfterPlanting !== undefined, {
    message: 'seasonalTask requires either dayOfYear or daysAfterPlanting'
  });

// ─── Phase 17 (Track 1) — agronomy block + per-crop spray windows ───────
//
// `agronomy` and `sprayWindows` move family-keyed lookup tables and
// hardcoded engine branches (rotation lookback, perennial detection,
// cover-crop termination lead, corn V2/V4 + cucurbit Clethodim windows)
// out of TypeScript and into per-crop plugin data. All fields optional so
// existing plugins keep working; engines fall through to a single
// family-default registry in `familyDefaults.ts` when omitted.

export const CROP_LIFECYCLES = ['annual', 'biennial', 'perennial'] as const;
export const cropLifecycleSchema = z.enum(CROP_LIFECYCLES);
export type CropLifecycle = (typeof CROP_LIFECYCLES)[number];

export const agronomySchema = z
  .object({
    /** Annual / biennial / perennial. Drives multi-year calendar rendering. */
    lifecycle: cropLifecycleSchema.optional(),
    /** Years before the same family may replant the same block. */
    rotationLookbackYears: z.number().int().min(0).max(10).optional(),
    /** Cover-crop only — minimum days between cover termination and next
     *  cash crop planting. */
    terminationLeadDaysMin: z.number().int().min(0).max(120).optional()
  })
  .partial();
export type Agronomy = z.infer<typeof agronomySchema>;

export const SPRAY_WINDOW_ANCHORS = ['planting', 'emergence', 'stage'] as const;

/**
 * Phase 21 (B-25) — slot taxonomy + strategy gates on per-crop spray windows.
 *
 * `purpose` lets the Phase 21 inputs planner know which "slot" each window
 * fills (burndown vs PRE vs POST herbicide; scheduled insecticide vs scout
 * placeholder; sidedress-N; fungicide; cover-crop terminate). Without
 * `purpose` tags, the planner cannot decide whether a `synthetic-auxin`
 * window is for weeds or for something else.
 *
 * `weedStrategyGate` / `pestStrategyGate` are minimum-eligibility filters:
 * a window with `pestStrategyGate: 'preventive'` is emitted ONLY when the
 * Season Setup picks `pestStrategy === 'preventive'`. Absent gate = always
 * emit (back-compat with v1 plugins that lack the field).
 *
 * All three fields are optional + additive — v1 plugins remain valid.
 */
export const SPRAY_WINDOW_PURPOSES = [
  'burndown',
  'pre-emergent',
  'post-emergent',
  'insecticide-prophylactic',
  'insecticide-scouted',
  'fungicide',
  'sidedress-n',
  'sidedress-other',
  'cover-terminate'
] as const;
export type SprayWindowPurpose = (typeof SPRAY_WINDOW_PURPOSES)[number];

export const cropSprayWindowSchema = z
  .object({
    /** Chemistry class the window applies to (matches kernel chemistry-class
     *  enum). The engine joins on this when projecting candidate sprays. */
    chemistryClass: z.enum(CHEMISTRY_CLASSES),
    /** Optional growth-stage anchor (matches a `growthStageTable.stages[].code`
     *  on this crop). When set, `anchor` should be 'stage'. */
    stageCode: z.string().min(1).max(16).optional(),
    /** Days from the anchor; min/max define the open window. */
    offsetDaysMin: z.number().int().nonnegative(),
    offsetDaysMax: z.number().int().nonnegative(),
    /** What the offset is measured from. */
    anchor: z.enum(SPRAY_WINDOW_ANCHORS),
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
    /** Phase 21 — slot the window fills. Consumed by the Phase 21 inputs
     *  planner (`lib/plan/inputsPlan.ts`). Optional for back-compat with
     *  v1 plugins; the planner emits a warning when missing rather than
     *  inferring from chemistryClass + title (which is unreliable). */
    purpose: z.enum(SPRAY_WINDOW_PURPOSES).optional(),
    /** Phase 21 — minimum Season Setup `weedStrategy` that should emit
     *  this window. Absent = always emit. Example: a `pre-emergent`
     *  window with `weedStrategyGate: 'pre-emergence-ok'` is excluded
     *  for `weedStrategy: 'cultivate-first'` users. */
    weedStrategyGate: z
      .enum(['cultivate-first', 'pre-emergence-ok', 'post-emergence-ok'])
      .optional(),
    /** Phase 21 — minimum Season Setup `pestStrategy` that should emit
     *  this window. Absent = always emit. Example: an `insecticide-
     *  prophylactic` window with `pestStrategyGate: 'preventive'` is
     *  excluded for `pestStrategy: 'ipm'` users (who get scout tasks
     *  instead). */
    pestStrategyGate: z.enum(['preventive', 'ipm']).optional()
  })
  .refine((v) => v.offsetDaysMin <= v.offsetDaysMax, {
    message: 'offsetDaysMin must be ≤ offsetDaysMax'
  })
  .refine((v) => v.anchor !== 'stage' || !!v.stageCode, {
    message: 'anchor "stage" requires stageCode'
  });
export type CropSprayWindow = z.infer<typeof cropSprayWindowSchema>;

export const cropPluginSchema = pluginBase.extend({
  type: z.literal('crop'),
  cropFamily: z.enum(CROP_FAMILIES),
  defaultRowSpacingInches: z.number().positive().max(360).optional(),
  preHarvestIntervalDays: z.number().int().nonnegative().optional(),
  daysToMaturity: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .optional(),
  /** Detailed planting guidance surfaced on /plan per-block (FR-13). */
  plantingGuide: plantingGuideSchema.optional(),
  /** Curing instructions + duration, surfaced on /harvest (FR-08). */
  postHarvestCuring: postHarvestCuringSchema.optional(),
  /** Orchard-only seasonal task list (FR-10). Kept for back-compat; new
   *  plugins should prefer the generic `seasonalTasks` field. */
  orchardSeasonalTasks: z.array(orchardSeasonalTaskSchema).optional(),
  /** Generic seasonal task list (Phase 9). Works for any crop family. */
  seasonalTasks: z.array(seasonalTaskSchema).optional(),
  // ─── v1.1 additions (HCD Guide §4) ──────────────────────────────────
  /** Operation model: single-event (vegetables), multi-step (hay), or
   * perennial-multi-cut (hay across cuttings). Drives FR-19 workflow. */
  cropOperationModel: cropOperationModelSchema.optional(),
  /** Hay-specific multi-step operation declaration (FR-19, FR-21, FR-23). */
  hayOperations: hayOperationsSchema.optional(),
  /** Small-grain Zadoks stage table (FR-20). */
  zadoksStages: z.array(zadoksStageSchema).optional(),
  /** Generic harvest-moisture gates (FR-21) — small grains, hay, etc. */
  moistureGates: z.array(harvestMoistureGateSchema).optional(),
  /**
   * Genetic / breeding traits the cultivar carries (Phase 11). Free-form
   * kebab-case identifiers. Herbicide plugins can declare `requiresTraits`
   * that, when fully present on the crop, exempt that herbicide from the
   * family-kill bypass check (because the trait is what makes the kill
   * matrix's default safe-list wrong for this specific cultivar).
   *
   * Example values:
   *   'glyphosate-tolerant-rr2', 'dicamba-tolerant-xtend',
   *   'glufosinate-tolerant-llink', 'imi-tolerant-clearfield',
   *   'enlist-2-4-d-tolerant'
   */
  traits: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).optional(),
  /**
   * Pre-task templates (Phase 12). When the operator schedules a primary
   * task tied to this crop (mow, harvest, plant, etc.), matching pre-tasks
   * auto-attach. Examples: "Test germination 14d before plant",
   * "Inspect deer fencing the day before silking starts".
   *
   * `daysBeforePlant` and `daysBeforeFirstHarvest` are the well-known
   * anchors; `phaseKey` lets a plugin tie a pre-task to one of its own
   * `seasonalTasks` entries by key.
   */
  preTasks: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        title: z.string().min(1).max(120),
        body: z.string().max(500).optional(),
        daysBeforePlant: z.number().int().nonnegative().optional(),
        daysBeforeFirstHarvest: z.number().int().nonnegative().optional(),
        phaseKey: z.string().min(1).max(80).optional(),
        daysBeforePhase: z.number().int().nonnegative().optional()
      })
    )
    .optional(),
  /** Post-task templates — fire after a referenced phase. Same anchors. */
  postTasks: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        title: z.string().min(1).max(120),
        body: z.string().max(500).optional(),
        daysAfterPlant: z.number().int().nonnegative().optional(),
        daysAfterHarvest: z.number().int().nonnegative().optional(),
        phaseKey: z.string().min(1).max(80).optional(),
        daysAfterPhase: z.number().int().nonnegative().optional()
      })
    )
    .optional(),
  // ─── v1.2 additions (Phase 14 swim-lane shade modeling) ─────────────
  /** Mature canopy height in feet. Used by the swim-lane shade heuristic
   *  to weight how much shadow this crop casts on neighbor blocks. */
  matureHeightFt: z.number().positive().max(60).optional(),
  /** Explicit shade-casting flag. True for tall crops (corn, sunflower,
   *  sorghum, sweet corn). Defaults to derivation from `matureHeightFt`
   *  when absent: `matureHeightFt >= 5` → casts shade. */
  shadeCasting: z.boolean().optional(),
  // ─── v1.3 additions (growth-stage phenology) ────────────────────────
  /** Per-variety stage system + day-from-planting offsets + harvest target(s).
   *  When omitted, the calendar engine falls back to the family default in
   *  `growthStageTemplates.ts`. Dual-purpose varieties (e.g., Bloody Butcher
   *  corn, harvestable as sweet eating at R3 or as dent at R6) list multiple
   *  `harvestTargets` and downstream UI / AI auto-schedule picks among them. */
  growthStageTable: growthStageTableSchema.optional(),
  /** Corn-family classifier: 'sweet' | 'popcorn' | 'dent' | 'flour' | 'flint'
   *  | 'dual-purpose'. UI filter + AI auto-schedule sugar; the actual harvest
   *  math is driven by `growthStageTable.harvestTargets`. Cross-field check:
   *  only valid when cropFamily === 'corn'. */
  cornType: cornTypeSchema.optional(),
  // ─── Phase 19 (cross-pollination advisory) ──────────────────────────
  /** Other crop plugins (by pluginId) or family tags (`family:<name>`) this
   *  cultivar cross-pollinates with. The allocator uses this to flag
   *  conflicts when two crossing varieties land on the same field at the
   *  same time. Family tags expand at load: `family:corn` matches every
   *  crop plugin with cropFamily='corn'. Omit if cross-pollination doesn't
   *  matter at home scale (most F1 hybrid vegetables). */
  crossesWith: z
    .array(z.string().regex(/^(family:)?[a-z0-9][a-z0-9-]{0,63}$/))
    .max(40)
    .optional(),
  /** Minimum spatial isolation in feet to consider two crossing varieties
   *  "isolated" (home-scale, not seed-saving production). When two varieties
   *  fall closer than this, the allocator either resolves spatially when an
   *  alternate block pairing achieves the distance OR emits an open
   *  temporal-stagger constraint for the scheduler to enforce. Defaults to
   *  the family-keyed table in `lib/plan/pollination.ts` if omitted. */
  isolationFeet: z.number().positive().max(5280).optional(),
  /** Minimum days between two crossing varieties' flowering windows when
   *  spatial isolation can't be achieved. e.g., 14d for corn silking. */
  isolationStaggerDays: z.number().int().positive().max(120).optional(),
  // ─── Phase 17 (Track 1) — agronomy block + per-crop spray windows ───
  /** Lifecycle, rotation, and termination-lead data the calendar engine
   *  used to derive from family-keyed lookup tables. Optional; missing
   *  values fall through to `familyDefaults.ts`. */
  agronomy: agronomySchema.optional(),
  /** Per-variety spray windows the engine surfaces on /plan as candidate
   *  application tasks. Replaces the corn V2/V3 + V4/V6 and cucurbit
   *  Clethodim windows previously hardcoded in `calendar/engine.ts`. */
  sprayWindows: z.array(cropSprayWindowSchema).optional(),
  // ────────────────────────────────────────────────────────────────────
  /** Legacy passthroughs from earlier phases — accepted but not validated. */
  planting: z.record(z.string(), z.unknown()).optional(),
  growthStages: z.array(z.record(z.string(), z.unknown())).optional(),
  harvestIndicators: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export const activeIngredientSchema = z.object({
  name: z.string().min(1),
  chemistryClass: z.enum(CHEMISTRY_CLASSES)
});

export const dilutionTableSchema = z.record(
  z.string().regex(/^\d+gal$/),
  z.object({
    amount: z.number().positive(),
    unit: z.enum(['oz', 'fl-oz', 'lb', 'pt', 'qt']),
    display: z.string().optional()
  })
);

/** Variable-rate per-management-zone (Phase 10 stub for §11 OOS). Optional;
 *  consumers without a zone-aware planter or a soil-test grid can ignore. */
const ratesPerZoneSchema = z.array(
  z.object({
    /** Zone label or soil-test polygon id. Free-form; the operator's call. */
    zone: z.string().min(1),
    amount: z.number().positive(),
    unit: z.enum(['oz', 'fl-oz', 'lb', 'pt', 'qt']),
    notes: z.string().optional()
  })
);

/**
 * Phase 21 (B-25) — input-plugin compliance flags consumed by the
 * `lib/season/philosophyFilter.ts` allow-deny matrix. Each flag is OPTIONAL
 * and "absent = unknown". The planner treats unknown as excluded — a safe
 * default that avoids retroactively breaking existing plugins (none of
 * which have the flags set today). Authors tag flags conservatively (only
 * mark `omriListed: true` when label-verified).
 *
 * Allow-deny matrix (per `philosophyFilter.ts`):
 *   conventional               — all allowed (no flag check)
 *   non-gmo                    — requires `nonGmoCompliant === true`
 *   organic-transitioning      — requires `transitioningAllowed === true`
 *                                  OR `omriListed === true`
 *   certified-organic          — requires `omriListed === true`
 *                                  AND `certifiedOrganicAllowed !== false`
 */
export const complianceFlagsSchema = z
  .object({
    /** OMRI-Listed for USDA-organic use (label-verified). */
    omriListed: z.boolean().optional(),
    /** Active ingredients are not GMO-derived. */
    nonGmoCompliant: z.boolean().optional(),
    /** Usable under National Organic Program rules. Authors set this to
     *  false to actively exclude a product from certified-organic use
     *  even if it would otherwise be OMRI-allowed (e.g., a recall). */
    certifiedOrganicAllowed: z.boolean().optional(),
    /** Usable during the 3-year organic transition window (slightly more
     *  permissive than NOP — allows certain conventional inputs in the
     *  early transition years). */
    transitioningAllowed: z.boolean().optional(),
    /** Author note explaining the compliance decision; surfaced in the
     *  product picker tooltip on the Inputs Plan step. */
    notes: z.string().max(500).optional()
  })
  .optional();

export const herbicidePluginSchema = pluginBase.extend({
  type: z.literal('herbicide'),
  activeIngredients: z.array(activeIngredientSchema).min(1),
  applicationTiming: z.enum(['BURNDOWN', 'PRE', 'POST', 'POST-DIRECTED']).optional(),
  ratePerAcre: z.object({
    amount: z.number().positive(),
    unit: z.enum(['oz', 'fl-oz', 'lb', 'pt', 'qt'])
  }),
  /** GPA the dilutionTable values are calibrated for (default 15 per FR-02). */
  gpaCalibration: z.number().int().positive().default(15),
  dilutionTable: dilutionTableSchema.optional(),
  acresPerTank: z.record(z.string().regex(/^\d+gal$/), z.number().positive()).optional(),
  requiresAMS: z.boolean().optional(),
  deconRequired: z.boolean().optional(),
  tankMixOrder: z.number().int().min(1).max(10).optional(),
  /** EPA registration number (e.g., '524-617'). Required for USDA / NRCS
   *  cost-share spray-record exports; optional on plugin so legacy plugins
   *  validate. The /records export warns when missing. */
  epaRegistrationNumber: z
    .string()
    .regex(/^\d{1,6}-\d{1,6}(-\d{1,6})?$/, 'EPA reg numbers look like 524-617 or 524-617-100')
    .optional(),
  /** Variable-rate stub — overrides ratePerAcre when the spray UI surfaces
   *  zones. Consumers without a zone-aware planter ignore this field. */
  ratesPerZone: ratesPerZoneSchema.optional(),
  /**
   * Trait-gated safety claims (Phase 11). Each entry says "this herbicide
   * is safe on cropPluginId X *if* the planted cultivar carries every
   * listed trait." The bypass check rejects the claim unless the registry
   * confirms the trait list. At spray time the kernel's family-kill rule
   * is skipped for (product, crop) pairs where the trait override fires.
   *
   * Example: engenia → `[{ cropPluginId: 'soybean-asgrow-roundup-ready-2-xtend',
   *   requiresTraits: ['dicamba-tolerant-xtend'] }]`
   */
  traitGatedSafeFor: z
    .array(
      z.object({
        cropPluginId: z.string(),
        requiresTraits: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).min(1)
      })
    )
    .optional(),
  labelClaims: z
    .object({
      safeForCropPluginIds: z.array(z.string()).optional()
    })
    .optional(),
  /** Phase 21 — philosophy filter flags. See `complianceFlagsSchema`. */
  complianceFlags: complianceFlagsSchema,
  notes: z.string().optional()
});

const insecticideIngredientSchema = z.object({
  name: z.string().min(1),
  /** IRAC mode-of-action group code (e.g., '1A', '3A', '4A', '5', '6', '11A', '15', '22', '28', '29', 'UN'). Used by agronomy/resistance.ts for rotation hints; NOT a safety-kernel input. */
  iracGroup: z
    .string()
    .regex(/^[A-Z0-9]{1,4}$/)
    .optional()
});

/** Phase 10: declarative scouting threshold. The /scout flow renders an
 *  observation form with the listed metric; if the recorded value crosses
 *  the threshold, the UI nudges the operator into the spray flow with this
 *  insecticide pre-selected. The kernel never auto-sprays. */
const scoutingThresholdSchema = z.object({
  /** Pest the threshold is observing (free-form; matches targetPests). */
  pest: z.string().min(1),
  /** Metric the observer counts. */
  metric: z.enum([
    'count-per-plant',
    'count-per-leaf',
    'count-per-trap-per-week',
    'pct-defoliation',
    'pct-infested-plants',
    'eggs-per-plant'
  ]),
  /** Spray-action threshold; values ≥ this nudge the spray flow. */
  threshold: z.number().nonnegative(),
  /** Optional warning band (yellow). */
  warnAt: z.number().nonnegative().optional(),
  notes: z.string().optional()
});

/** Phase 10: multi-step application protocol — e.g. burndown then post-emerge,
 *  Bt rotation cycle, biocontrol release schedule. Free-form steps the UI
 *  renders as a checklist on the spray prep screen. */
const applicationProtocolStepSchema = z.object({
  step: z.string().min(1),
  detail: z.string().optional(),
  /** Day-offset from the first application (0 = same day). */
  dayOffset: z.number().int().nonnegative().optional()
});

export const insecticidePluginSchema = pluginBase.extend({
  type: z.literal('insecticide'),
  activeIngredients: z.array(insecticideIngredientSchema).min(1),
  reEntryIntervalHours: z.number().int().nonnegative(),
  /** Phase 9 additions — all optional for back-compat with v1 plugins. */
  preHarvestIntervalDays: z.number().int().nonnegative().optional(),
  ratePerAcre: z
    .object({
      amount: z.number().positive(),
      unit: z.enum(['oz', 'fl-oz', 'lb', 'pt', 'qt'])
    })
    .optional(),
  gpaCalibration: z.number().int().positive().default(15).optional(),
  dilutionTable: dilutionTableSchema.optional(),
  targetPests: z.array(z.string().min(1)).optional(),
  pollinatorRisk: z.enum(['none', 'low', 'moderate', 'high']).optional(),
  /** Phase 10: scouting nudge thresholds — drives /scout → /spray handoff. */
  scoutingThresholds: z.array(scoutingThresholdSchema).optional(),
  /** Phase 10: multi-step protocol — e.g. Bt rotation, biocontrol release. */
  applicationProtocol: z.array(applicationProtocolStepSchema).optional(),
  /** Phase 10: EPA reg number for USDA / NRCS spray-record export. */
  epaRegistrationNumber: z
    .string()
    .regex(/^\d{1,6}-\d{1,6}(-\d{1,6})?$/, 'EPA reg numbers look like 524-617 or 524-617-100')
    .optional(),
  labelClaims: z
    .object({
      safeForCropPluginIds: z.array(z.string()).optional(),
      safeForCropFamilies: z.array(z.enum(CROP_FAMILIES)).optional()
    })
    .optional(),
  /** Phase 21 — philosophy filter flags. See `complianceFlagsSchema`. */
  complianceFlags: complianceFlagsSchema,
  notes: z.string().optional()
});

/**
 * Fungicide ingredient — FRAC code is a string (M01, M03, 1, 7, 11, 21, P01, ...).
 * NOT consumed by the safety kernel kill-matrix; used by
 * `agronomy/resistance.ts` for rotation hints (don't apply same FRAC group
 * twice in a row).
 */
const fungicideIngredientSchema = z.object({
  name: z.string().min(1),
  fracCode: z
    .string()
    .regex(
      /^(M\d{2}|P\d{2}|U\d{2}|BM\d{2}|\d{1,3})$/,
      'fracCode must look like M03, P01, U06, BM01, or a number'
    )
});

export const fungicidePluginSchema = pluginBase.extend({
  type: z.literal('fungicide'),
  activeIngredients: z.array(fungicideIngredientSchema).min(1),
  applicationTiming: z
    .enum(['DORMANT', 'PRE-BLOOM', 'BLOOM', 'POST-BLOOM', 'COVER', 'PRE-HARVEST'])
    .optional(),
  ratePerAcre: z.object({
    amount: z.number().positive(),
    unit: z.enum(['oz', 'fl-oz', 'lb', 'pt', 'qt'])
  }),
  gpaCalibration: z.number().int().positive().default(15),
  dilutionTable: dilutionTableSchema.optional(),
  reEntryIntervalHours: z.number().int().nonnegative(),
  preHarvestIntervalDays: z.number().int().nonnegative(),
  pollinatorRisk: z.enum(['none', 'low', 'moderate', 'high']).optional(),
  /** Fungicides rarely require sprayer decon (no herbicide cross-contam class) but a few do (e.g., copper after a Bordeaux mix). */
  deconRequired: z.boolean().optional(),
  targetDiseases: z.array(z.string().min(1)).optional(),
  labelClaims: z
    .object({
      safeForCropPluginIds: z.array(z.string()).optional(),
      safeForCropFamilies: z.array(z.enum(CROP_FAMILIES)).optional()
    })
    .optional(),
  /** Phase 21 — philosophy filter flags. See `complianceFlagsSchema`. */
  complianceFlags: complianceFlagsSchema,
  notes: z.string().optional()
});

export const fertilizerPluginSchema = pluginBase.extend({
  type: z.literal('fertilizer'),
  /** Guaranteed analysis — N-P-K percentage by weight. P is reported as P2O5 elemental %, K as K2O elemental %, per US labeling convention. */
  analysis: z.object({
    n: z.number().min(0).max(100),
    p: z.number().min(0).max(100),
    k: z.number().min(0).max(100)
  }),
  form: z.enum(['granular', 'liquid', 'soluble', 'compost', 'slow-release', 'meal']),
  organic: z.boolean().default(false),
  secondaryNutrients: z
    .object({
      ca: z.number().min(0).max(100).optional(),
      mg: z.number().min(0).max(100).optional(),
      s: z.number().min(0).max(100).optional(),
      b: z.number().min(0).max(100).optional(),
      zn: z.number().min(0).max(100).optional(),
      mn: z.number().min(0).max(100).optional(),
      cu: z.number().min(0).max(100).optional(),
      fe: z.number().min(0).max(100).optional()
    })
    .optional(),
  applicationRange: z
    .object({
      min: z.number().positive(),
      max: z.number().positive(),
      unit: z.enum(['lb-per-acre', 'gal-per-acre', 'ton-per-acre'])
    })
    .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' })
    .optional(),
  /** Phase 21 — philosophy filter flags. See `complianceFlagsSchema`. The
   *  fertilizer plugin already carries `organic: boolean`; that flag is
   *  the source of truth for "is this an organic-source amendment" while
   *  `complianceFlags` adds the NOP / OMRI distinction (e.g., a manure
   *  compost can be `organic: true` but `omriListed: false` if uncertified). */
  complianceFlags: complianceFlagsSchema,
  notes: z.string().optional()
});

// ─── Phase 17 (Track 1, B8) — companion-system shape ────────────────────
//
// The original `companion` plugin (goodWith/badWith) describes general
// crop affinity. A companion-SYSTEM (e.g. Three Sisters) additionally
// declares an ordered planting protocol: a primary crop family and one or
// more secondary members planted at relative day offsets. The engine emits
// one `companion-trigger` event per member when the primary is planted.
//
// Both shapes share `type: 'companion'`. Presence of `members` opts into
// the system shape; absence keeps the legacy goodWith/badWith semantics.

export const companionSystemMemberSchema = z.object({
  /** Crop family this member must belong to (engine matches against
   *  registered crop plugins). */
  family: z.enum(CROP_FAMILIES),
  /** Free-form role label surfaced in the suggestion UI ("trellis", "ground-cover"). */
  role: z.string().min(1).max(80),
  /** Days after the primary planting when this member should go in. */
  plantingOffsetDays: z.number().int().nonnegative().max(365),
  /** Optional title override for the engine's companion-trigger event. */
  title: z.string().min(1).max(120).optional(),
  /** Optional body override. */
  body: z.string().max(500).optional()
});
export type CompanionSystemMember = z.infer<typeof companionSystemMemberSchema>;

export const companionPluginSchema = pluginBase.extend({
  type: z.literal('companion'),
  goodWith: z.array(z.string()).default([]),
  badWith: z.array(z.string()).default([]),
  /** Companion-system declaration. When present, the engine emits
   *  `companion-trigger` events for each member after the primary planting. */
  primaryFamily: z.enum(CROP_FAMILIES).optional(),
  members: z.array(companionSystemMemberSchema).optional(),
  /** Short benefit description surfaced in the companion suggestion UI. */
  benefit: z.string().max(500).optional()
});

export const pluginSchema = z.discriminatedUnion('type', [
  cropPluginSchema,
  herbicidePluginSchema,
  insecticidePluginSchema,
  fungicidePluginSchema,
  fertilizerPluginSchema,
  companionPluginSchema
]);

export type CropPlugin = z.infer<typeof cropPluginSchema>;
export type HerbicidePlugin = z.infer<typeof herbicidePluginSchema>;
export type InsecticidePlugin = z.infer<typeof insecticidePluginSchema>;
export type FungicidePlugin = z.infer<typeof fungicidePluginSchema>;
export type FertilizerPlugin = z.infer<typeof fertilizerPluginSchema>;
export type CompanionPlugin = z.infer<typeof companionPluginSchema>;
export type Plugin = z.infer<typeof pluginSchema>;
