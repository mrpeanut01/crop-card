import { z } from 'zod';
import { ANIMAL_DOSE_ROUTES } from '$lib/plugins/schemas';
import {
  FOODS,
  HEALTH_EVENT_KINDS,
  LABEL_USE_DECLARATIONS,
  MAX_ENTRY_DAYS,
  PRODUCTION_USES
} from '$lib/safety/animalWithdrawal';
import { ANIMAL_SUBJECT_TYPES, MAX_NOTES, MAX_REASON } from './model';

/** Request bodies of the 32C health, production and grazing attestation
 *  endpoints. Free of server imports so the OpenAPI generator can publish
 *  them. */

const id = z.string().min(1).max(128);
const ms = z.number().int().positive();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const PRODUCTION_KINDS = ['eggs', 'milk', 'weight'] as const;
export type ProductionKind = (typeof PRODUCTION_KINDS)[number];

export const PRODUCTION_UNITS = ['eggs', 'dozen', 'lb', 'kg', 'gal', 'qt', 'l'] as const;

/** `POST /api/animals/health/record`. Owners and helpers. Any event that
 *  names a product carries a withdrawal hold (C-19). A vet-directed
 *  withdrawal is added afterwards by the owner through
 *  `POST /api/animals/health/:id/entries`, never here, so a helper cannot
 *  set it. Safe to replay from the offline queue. */
export const healthRecordSchema = z
  .strictObject({
    subjectType: z.enum(ANIMAL_SUBJECT_TYPES),
    subjectId: id,
    kind: z.enum(HEALTH_EVENT_KINDS),
    productPluginId: id.nullable().optional(),
    productName: optionalText(200),
    stockItemId: id.nullable().optional(),
    lotNumber: optionalText(80),
    dose: z.number().positive().max(1_000_000).nullable().optional(),
    doseUnit: optionalText(20),
    route: z.enum(ANIMAL_DOSE_ROUTES).nullable().optional(),
    administeredAt: ms,
    courseEndAt: ms.nullable().optional(),
    courseOpen: z.boolean().optional(),
    labelUse: z.enum(LABEL_USE_DECLARATIONS).nullable().optional(),
    vetName: optionalText(120),
    notes: optionalText(MAX_NOTES)
  })
  .refine((v) => !v.courseEndAt || v.courseEndAt >= v.administeredAt, {
    message: 'the last dose cannot be before the first dose',
    path: ['courseEndAt']
  })
  .refine((v) => !(v.courseOpen && v.courseEndAt), {
    message: 'a course with a last dose is not open',
    path: ['courseOpen']
  })
  .refine((v) => v.labelUse !== 'extra-label-vet' || !!v.vetName?.trim(), {
    message: 'extra-label use needs the vet who directed it',
    path: ['vetName']
  });

const amount = z.number().int().min(0);

/** `POST /api/animals/health/:id/entries`. Owner only, append-only (C-01,
 *  C-03, C-13). Numbers are typed by the owner from the label or the vet;
 *  they are never pre-filled and never come from AI. */
export const withdrawalEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('label'),
    food: z.enum(FOODS),
    amount,
    unit: z.enum(['days', 'hours']),
    labelNamesSpeciesAndClass: z.boolean(),
    labelSaysNone: z.boolean().optional()
  }),
  z.strictObject({
    kind: z.literal('vet'),
    food: z.enum(FOODS),
    amount,
    unit: z.enum(['days', 'hours']),
    vetName: z.string().trim().min(1).max(120),
    vetSaysNone: z.boolean().optional()
  }),
  z.strictObject({ kind: z.literal('course-end'), endedAt: ms }),
  z.strictObject({ kind: z.literal('product'), pluginId: id, onLabel: z.boolean() })
]);

/** `POST /api/animals/production/record`. Owners and helpers. `food` and
 *  `sale` run the withdrawal gate with no override; `discard` always saves.
 *  Safe to replay from the offline queue. */
export const productionRecordSchema = z
  .strictObject({
    subjectType: z.enum(ANIMAL_SUBJECT_TYPES),
    subjectId: id,
    kind: z.enum(PRODUCTION_KINDS),
    quantity: z.number().min(0).max(1_000_000),
    unit: z.enum(PRODUCTION_UNITS),
    occurredAt: ms.optional(),
    use: z.enum(PRODUCTION_USES)
  })
  .refine((v) => v.kind !== 'weight' || v.unit === 'lb' || v.unit === 'kg', {
    message: 'weigh in lb or kg',
    path: ['unit']
  });

/** `PATCH /api/animals/production/:id`. A change toward discard always
 *  saves, even on a locked log; any other change runs the gate (C-07). */
export const productionPatchSchema = z.strictObject({
  use: z.enum(PRODUCTION_USES),
  reason: optionalText(MAX_REASON)
});

/** `POST /api/animals/grazing-attestations`. Owner only. One row per
 *  application and product (C-27); several applications on the same Area
 *  can be attested in one save. Days are read from the label; 0 means the
 *  label states none. Each label interval is its own value: the general
 *  grazing time, the lactating dairy time (never shorter, C-25), the hay
 *  time and the meat-animal removal before slaughter. One left out stays
 *  unknown. */
export const grazingAttestationSchema = z.strictObject({
  fieldId: id,
  reason: z.string().trim().min(1).max(MAX_REASON),
  items: z
    .array(
      z
        .strictObject({
          sprayEventRef: z
            .string()
            .regex(/^(spray|insecticide|fungicide):[A-Za-z0-9_-]{1,128}$/, 'unknown application'),
          productPluginId: id.nullable().optional(),
          grazeDays: z.number().int().min(0).max(MAX_ENTRY_DAYS).nullable().optional(),
          hayDays: z.number().int().min(0).max(MAX_ENTRY_DAYS).nullable().optional(),
          lactatingGrazeDays: z.number().int().min(0).max(MAX_ENTRY_DAYS).nullable().optional(),
          meatRemovalDays: z.number().int().min(0).max(MAX_ENTRY_DAYS).nullable().optional()
        })
        .refine(
          (v) =>
            v.grazeDays != null ||
            v.hayDays != null ||
            v.lactatingGrazeDays != null ||
            v.meatRemovalDays != null,
          { message: 'enter at least one time from the label', path: ['grazeDays'] }
        )
        .refine(
          (v) =>
            v.grazeDays == null ||
            v.lactatingGrazeDays == null ||
            v.lactatingGrazeDays >= v.grazeDays,
          {
            message: 'the wait for milking animals is never shorter than the general grazing wait',
            path: ['lactatingGrazeDays']
          }
        )
    )
    .min(1)
    .max(50)
});

export type HealthRecordInput = z.infer<typeof healthRecordSchema>;
export type WithdrawalEntryInput = z.infer<typeof withdrawalEntrySchema>;
export type ProductionRecordInput = z.infer<typeof productionRecordSchema>;
export type GrazingAttestationRequest = z.infer<typeof grazingAttestationSchema>;
