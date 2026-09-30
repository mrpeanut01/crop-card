/**
 * Request schemas for the watering endpoints (Phase 32E, E4). Client-safe,
 * so the OpenAPI generator and the drift test read the same Zod schema the
 * routes validate with.
 */

import { z } from 'zod';

export const IRRIGATION_METHOD_VALUES = [
  'drip',
  'soaker',
  'sprinkler',
  'hand',
  'flood',
  'other'
] as const;

const id = z.string().min(1).max(128);
const epochMs = z.number().int().positive();

export const irrigationCreateSchema = z
  .object({
    fieldId: id.describe('The Area watered.'),
    blockId: id.nullable().optional().describe('One bed of that Area; omit for the whole Area.'),
    occurredAt: epochMs.optional().describe('When the watering happened; defaults to now.'),
    durationMin: z.number().int().min(1).max(1440).nullable().optional(),
    inches: z.number().min(0).max(10).nullable().optional(),
    gallons: z.number().positive().max(1_000_000).nullable().optional(),
    method: z.enum(IRRIGATION_METHOD_VALUES).nullable().optional(),
    notes: z.string().max(500).nullable().optional()
  })
  .refine(
    (v) =>
      (v.durationMin ?? null) !== null ||
      (v.inches ?? null) !== null ||
      (v.gallons ?? null) !== null,
    { message: 'Give the inches, gallons or minutes.' }
  );

export type IrrigationCreate = z.infer<typeof irrigationCreateSchema>;

export const rainGaugeCreateSchema = z.object({
  fieldIds: z
    .array(id)
    .min(1)
    .max(20)
    .describe('One reading can count for several Areas; each gets its own row.'),
  readAt: epochMs.optional().describe('When the gauge was read; defaults to now.'),
  inches: z.number().min(0).max(15)
});

export type RainGaugeCreate = z.infer<typeof rainGaugeCreateSchema>;

export const waterTargetSchema = z.object({
  fieldId: id,
  inches: z
    .number()
    .min(0.1)
    .max(5)
    .nullable()
    .describe('Inches a week for this Area; null goes back to the default.')
});

export type WaterTargetInput = z.infer<typeof waterTargetSchema>;
