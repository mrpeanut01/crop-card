import { z } from 'zod';
import { BED_LENGTH_LIMITS, BED_WIDTH_LIMITS } from './bedLayout';

/** POST /api/plan/beds/suggest (#475): the counted seed the planning wizard
 *  holds, and the owner's usual bed size. */
export const bedLayoutRequestSchema = z.object({
  seeds: z
    .array(
      z
        .object({
          stockItemId: z.string().min(1).max(128),
          plants: z.number().int().positive().max(100_000).optional(),
          /** #555: square feet for a crop sown by area. */
          areaSqFt: z.number().int().positive().max(1_000_000).optional()
        })
        .refine((s) => s.plants !== undefined || s.areaSqFt !== undefined, {
          message: 'plants or areaSqFt is required',
          path: ['plants']
        })
    )
    .min(1)
    .max(40),
  bedWidthFt: z.number().min(BED_WIDTH_LIMITS.min).max(BED_WIDTH_LIMITS.max),
  maxBedLengthFt: z.number().min(BED_LENGTH_LIMITS.min).max(BED_LENGTH_LIMITS.max)
});

export type BedLayoutRequest = z.infer<typeof bedLayoutRequestSchema>;
