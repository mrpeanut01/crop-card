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
    recommendedLbsPerAcre: z.number().positive().optional()
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

/** Zadoks small-grain growth-stage table (FR-20). */
export const zadoksStageSchema = z.object({
  stage: z.string().regex(/^Z\d{2}(-Z\d{2})?$/, 'stage must look like Z30 or Z30-Z39'),
  name: z.string().min(1),
  daysFromPlanting: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().positive() })
    .refine((v) => v.min <= v.max, { message: 'min must be ≤ max' })
});

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
  notes: z.string().optional()
});

export const companionPluginSchema = pluginBase.extend({
  type: z.literal('companion'),
  goodWith: z.array(z.string()).default([]),
  badWith: z.array(z.string()).default([])
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
