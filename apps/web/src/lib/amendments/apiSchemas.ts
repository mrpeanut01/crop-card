/** Request schemas for /api/amendments/batches/** (33C, M-62). Client-safe. */

import { z } from 'zod';
import {
  BATCH_KINDS,
  BATCH_NAME_MAX,
  BATCH_NOTES_MAX,
  BATCH_ORIGINS,
  INPUT_TYPES,
  SUPPLIER_MAX,
  SUPPLIER_STATEMENT_VALUES
} from './model';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const text = (min: number, max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.trim())
    .pipe(z.string().min(min).max(max));

const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.trim() || null)
    .pipe(z.string().max(max).nullable())
    .nullish();

export const batchCreateSchema = z
  .strictObject({
    kind: z.enum(BATCH_KINDS),
    name: text(1, BATCH_NAME_MAX),
    origin: z.enum(BATCH_ORIGINS),
    /** Farm-local day the pile was started or the load arrived (M-35). */
    startedOn: ymd,
    supplier: optionalText(SUPPLIER_MAX),
    supplierStatement: z.enum(SUPPLIER_STATEMENT_VALUES).nullish(),
    notes: optionalText(BATCH_NOTES_MAX)
  })
  .refine((b) => b.origin === 'bought' || (!b.supplier && !b.supplierStatement), {
    message: 'Only a bought load has a supplier.',
    path: ['supplier']
  });
export type BatchCreate = z.infer<typeof batchCreateSchema>;

export const batchPatchSchema = z
  .strictObject({
    name: text(1, BATCH_NAME_MAX).optional(),
    notes: optionalText(BATCH_NOTES_MAX),
    /** A farm-local day closes the batch; null reopens it. */
    closedOn: ymd.nullable().optional(),
    supplier: optionalText(SUPPLIER_MAX),
    supplierStatement: z.enum(SUPPLIER_STATEMENT_VALUES).nullable().optional()
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Nothing to change.'
  });
export type BatchPatch = z.infer<typeof batchPatchSchema>;

export const batchInputCreateSchema = z
  .strictObject({
    inputType: z.enum(INPUT_TYPES),
    inputId: z.string().min(1).max(80),
    /** Farm-local day: the collection start, or the day a batch or lot
     *  went in. */
    from: ymd,
    /** Farm-local last day of collection, animals and groups only. */
    to: ymd.nullish(),
    /** The supplier's answer for a stock lot. */
    supplierStatement: z.enum(SUPPLIER_STATEMENT_VALUES).nullish()
  })
  .refine((b) => !b.to || b.inputType === 'animal' || b.inputType === 'group', {
    message: 'Only an animal or group has a collection end.',
    path: ['to']
  })
  .refine((b) => !b.supplierStatement || b.inputType === 'stock-lot', {
    message: 'Only a stock lot has a supplier statement.',
    path: ['supplierStatement']
  });
export type BatchInputCreate = z.infer<typeof batchInputCreateSchema>;

/** Body of `POST /api/amendments/bioassays` (M-49): a batch or a block. */
export const bioassayCreateSchema = z
  .strictObject({
    batchId: z.string().min(1).max(80).nullish(),
    blockId: z.string().min(1).max(80).nullish(),
    /** Farm-local day the test was read; not in the future. */
    testedOn: ymd,
    result: z.enum(['no-damage', 'damage']),
    note: optionalText(500)
  })
  .refine((b) => !b.batchId !== !b.blockId, {
    message: 'Name a batch or a block, not both.',
    path: ['blockId']
  });
export type BioassayCreate = z.infer<typeof bioassayCreateSchema>;

/** Body of `POST /api/amendments/dismissals` (M-49), owner only. */
export const dismissalCreateSchema = z.strictObject({
  fertilityApplicationId: z.string().min(1).max(80),
  blockId: z.string().min(1).max(80),
  reason: text(3, 500)
});
export type DismissalCreate = z.infer<typeof dismissalCreateSchema>;
