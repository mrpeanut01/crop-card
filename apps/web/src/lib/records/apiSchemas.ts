import { z } from 'zod';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';

/** Request bodies of the six replayable record endpoints. Kept free of server
 *  imports so the OpenAPI generator can publish them. */

const conditionsSchema = z.object({
  windMph: z.number().nonnegative(),
  tempF: z.number(),
  rainForecastMmNext24h: z.number().nonnegative()
});

export const sprayCropStageSchema = z.object({
  cropPluginId: z.string().min(1),
  cropFamily: z.enum(CROP_FAMILIES).optional(),
  heightInches: z.number().nonnegative().optional()
});

export const sprayRecordSchema = z.object({
  blockId: z.string().min(1),
  /** When a `taskId` is also sent, that primary task is closed on success. */
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  occurredAt: z.number().int().optional(),
  blockCrops: z.object({
    primary: sprayCropStageSchema,
    coPlanted: z.array(sprayCropStageSchema).optional()
  }),
  productPluginIds: z.array(z.string().min(1)).min(1),
  /** Parallel to productPluginIds; a missing entry falls back to lookup by pluginId. */
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
  sprayer: z.object({ id: z.string().min(1) }),
  conditions: conditionsSchema.extend({
    /** Omitted means `default`, so a synthetic reading is never stored as measured. */
    conditionsProvenance: z.enum(['measured', 'default']).optional()
  }),
  /** Tank size for the stock decrement; without it nothing is decremented. */
  tankSizeGallons: z.number().positive().optional(),
  customRateOverride: z.boolean().optional(),
  notes: z.string().max(500).optional()
});

export const insecticideRecordSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  /** When the operator recorded it; the pollinator time-of-day gate keys off this. */
  occurredAt: z.number().int().optional(),
  productPluginIds: z.array(z.string().min(1)).min(1),
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
  sprayerId: z.string().min(1).optional(),
  conditions: conditionsSchema,
  scout: z
    .object({
      pest: z.string().min(1),
      metric: z.string().min(1),
      value: z.number().nonnegative(),
      threshold: z.number().nonnegative().optional(),
      notes: z.string().max(500).optional()
    })
    .optional(),
  tankSizeGallons: z.number().positive().optional(),
  /** Missing means derived from crop bloom windows, else `unknown`. */
  bloomStatus: z.enum(['in-bloom', 'not-in-bloom', 'unknown']).optional(),
  /** Only consulted when sunrise and sunset cannot be computed for a dusk-to-dawn label. */
  attestedNoForagers: z.boolean().optional()
});

export const fungicideRecordSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  occurredAt: z.number().int().optional(),
  productPluginIds: z.array(z.string().min(1)).min(1),
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
  sprayerId: z.string().min(1).optional(),
  conditions: conditionsSchema,
  disease: z
    .object({
      disease: z.string().min(1),
      metric: z.string().min(1),
      value: z.number().nonnegative(),
      threshold: z.number().nonnegative().optional(),
      notes: z.string().max(500).optional()
    })
    .optional(),
  tankSizeGallons: z.number().positive().optional()
});

export const harvestRecordSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  cropPluginId: z.string().min(1),
  occurredAt: z.number().int().optional(),
  quantity: z.string().max(60).optional(),
  lotNumber: z.string().max(40).optional(),
  /** Stored moisture %, checked against the crop archetype's threshold. */
  moisturePct: z.number().min(0).max(100).optional()
});

export const scoutRecordSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  pest: z.string().min(1).max(80),
  metric: z.string().min(1).max(40),
  value: z.number().nonnegative(),
  notes: z.string().max(500).optional(),
  occurredAt: z.number().int().optional()
});

export const hayCuttingSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  cropPluginId: z.string().min(1),
  year: z.number().int().min(1900).max(3000).optional(),
  cuttingNumber: z.number().int().positive().optional(),
  mowAt: z.number().int().optional(),
  forecast: z
    .array(
      z.object({
        date: z.string().min(1),
        popPct: z.number().min(0).max(100),
        highF: z.number(),
        lowF: z.number(),
        windMph: z.number().nonnegative().optional(),
        shortForecast: z.string().optional()
      })
    )
    .optional(),
  /** True when the operator mows despite a no-go from the mow decision. */
  overrideMowGate: z.boolean().optional(),
  notes: z.string().max(500).optional()
});

const farmDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-01-31.');

/** 33B (B-42): the window of the treatment log and the certifier pack, as
 *  farm-local days. Both are required; `to` covers its whole day. */
export const exportWindowQuerySchema = z.strictObject({
  from: farmDay,
  to: farmDay
});

/** `documents=1` adds the linked files themselves to the pack (B-43). */
export const organicPackQuerySchema = exportWindowQuerySchema.extend({
  documents: z.enum(['0', '1']).optional()
});
