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
    .record(
      z.enum(['small-square', 'large-round', 'large-square']),
      moistureThresholdsSchema
    )
    .optional(),
  /** Storage temperature watch — fires reminder events (FR-23 supports). */
  storageTempWatchF: z
    .object({ warn: z.number(), danger: z.number() })
    .optional()
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
      .enum(['spray', 'cultural', 'pruning', 'thinning', 'fertilize', 'irrigate', 'scout', 'harvest'])
      .default('cultural'),
    dayOfYear: z.number().int().min(1).max(366).optional(),
    daysAfterPlanting: z.number().int().min(0).max(3650).optional(),
    windowDays: z.number().int().min(1).max(60).default(7),
    title: z.string().min(1),
    body: z.string().optional()
  })
  .refine((v) => v.dayOfYear !== undefined || v.daysAfterPlanting !== undefined, {
    message: 'seasonalTask requires either dayOfYear or daysAfterPlanting'
  });

export const cropPluginSchema = pluginBase.extend({
  type: z.literal('crop'),
  cropFamily: z.enum(CROP_FAMILIES),
  defaultRowSpacingInches: z.number().positive().max(120).optional(),
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
  labelClaims: z
    .object({
      safeForCropPluginIds: z.array(z.string()).optional()
    })
    .optional(),
  notes: z.string().optional()
});

const insecticideIngredientSchema = z.object({
  name: z.string().min(1)
});

export const insecticidePluginSchema = pluginBase.extend({
  type: z.literal('insecticide'),
  activeIngredients: z.array(insecticideIngredientSchema).min(1),
  reEntryIntervalHours: z.number().int().nonnegative()
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
  companionPluginSchema
]);

export type CropPlugin = z.infer<typeof cropPluginSchema>;
export type HerbicidePlugin = z.infer<typeof herbicidePluginSchema>;
export type InsecticidePlugin = z.infer<typeof insecticidePluginSchema>;
export type CompanionPlugin = z.infer<typeof companionPluginSchema>;
export type Plugin = z.infer<typeof pluginSchema>;
