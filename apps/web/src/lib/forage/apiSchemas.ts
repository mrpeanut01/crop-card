/** Request schemas for /api/forage/** (Phase 33C, M-58, M-62). Client-safe. */

import { z } from 'zod';
import {
  FORAGE_HCN_MAX,
  FORAGE_LAB_MAX,
  FORAGE_NITRATE_MAX,
  FORAGE_NITRATE_UNITS,
  FORAGE_RATING_MAX,
  RATING_BASES
} from './model';

const id = z.string().min(1).max(200);
const rating = z
  .string()
  .max(FORAGE_RATING_MAX * 4)
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(FORAGE_RATING_MAX));

export const forageTestCreateSchema = z
  .strictObject({
    blockId: id.optional(),
    hayCuttingId: id.optional(),
    stockLotId: id.optional(),
    /** Farm-local day the sample was taken, not in the future. */
    sampledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'),
    lab: z
      .string()
      .max(FORAGE_LAB_MAX * 4)
      .transform((s) => s.trim() || undefined)
      .pipe(z.string().max(FORAGE_LAB_MAX).optional())
      .optional(),
    nitrateValue: z.number().min(0).max(FORAGE_NITRATE_MAX).optional(),
    nitrateUnits: z.enum(FORAGE_NITRATE_UNITS).optional(),
    hcnPpm: z.number().min(0).max(FORAGE_HCN_MAX).optional(),
    labRating: z
      .strictObject({
        nitrate: rating.optional(),
        hcn: rating.optional(),
        basis: z.enum(RATING_BASES).optional()
      })
      .optional(),
    /** A lab report already in the farm's documents. Owner only. */
    documentId: id.optional()
  })
  .refine((b) => [b.blockId, b.hayCuttingId, b.stockLotId].filter(Boolean).length === 1, {
    message: 'Pick exactly one of a block, a hay cutting or a feed lot.',
    path: ['blockId']
  })
  .refine((b) => (b.nitrateValue === undefined) === (b.nitrateUnits === undefined), {
    message: 'A nitrate value needs its units, and units need a value.',
    path: ['nitrateUnits']
  })
  .refine(
    (b) =>
      b.nitrateValue !== undefined ||
      b.hcnPpm !== undefined ||
      !!b.labRating?.nitrate ||
      !!b.labRating?.hcn,
    { message: 'Enter at least one value or the lab rating.', path: ['nitrateValue'] }
  );

export type ForageTestCreate = z.infer<typeof forageTestCreateSchema>;
