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

export const cropPluginSchema = pluginBase.extend({
  type: z.literal('crop'),
  cropFamily: z.enum(CROP_FAMILIES),
  defaultRowSpacingInches: z.number().positive().max(120).optional(),
  preHarvestIntervalDays: z.number().int().nonnegative().optional(),
  daysToMaturity: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .optional(),
  /** Spec-richer fields are accepted but not deeply validated yet. Phase 4
   *  introduces calendar-engine schemas that tighten this. */
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
