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

// ─── Phase 37E: automatic waterers ─────────────────────────────────────

export const WATERER_METHODS = ['drip', 'soaker', 'sprinkler'] as const;
export type WatererMethod = (typeof WATERER_METHODS)[number];

/** `HH:MM`, 24-hour, in the farm's time zone. */
export const SCHEDULE_START_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A timer's weekly program, typed by the owner (`manual`, R-12). Days are
 *  0 (Sunday) to 6 (Saturday). The amount is known only when the owner gives
 *  inches per run, or gallons per minute for a single target. */
export const irrigationScheduleSchema = z.strictObject({
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((d) => new Set(d).size === d.length, { message: 'Each day once.' })
    .describe('Days of the week it runs, 0 = Sunday.'),
  start: z.string().regex(SCHEDULE_START_RE).describe('Start time, HH:MM in the farm time zone.'),
  minutes: z.number().int().min(1).max(720),
  method: z.enum(WATERER_METHODS),
  inchesPerRun: z.number().min(0.01).max(5).nullable().optional(),
  gallonsPerMinute: z.number().positive().max(500).nullable().optional()
});

export type IrrigationSchedule = z.infer<typeof irrigationScheduleSchema>;

/** The schedule as stored in `equipment.spec.schedule`. The server sets
 *  `activeFrom` when the schedule is saved or changed, so runs from before
 *  it was set up never count as water given. */
export const storedScheduleSchema = irrigationScheduleSchema.extend({
  activeFrom: z.number().int().nonnegative()
});

export type StoredSchedule = z.infer<typeof storedScheduleSchema>;

export const waterTargetsSchema = z.strictObject({
  areaIds: z.array(id).max(50).describe('Areas the waterer covers whole.'),
  blockIds: z.array(id).max(200).describe('Single beds the waterer covers.')
});

export type WaterTargetsInput = z.infer<typeof waterTargetsSchema>;

export const IRRIGATION_SKIP_REASON_VALUES = [
  'did-not-run',
  'turned-off-for-rain',
  'other'
] as const;

export const irrigationSkipSchema = z.strictObject({
  equipmentId: id,
  scheduledAt: epochMs.describe('The start of the scheduled run that did not water.'),
  reason: z.enum(IRRIGATION_SKIP_REASON_VALUES),
  notes: z.string().max(500).nullable().optional()
});

export type IrrigationSkipInput = z.infer<typeof irrigationSkipSchema>;
