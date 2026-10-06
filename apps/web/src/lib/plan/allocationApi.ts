import { z } from 'zod';

/** One seed the planning wizard sends to allocate (and refine). #471: a
 *  seed with no quantity anywhere is sent as `fillToBed` and the server
 *  sizes it to the space it gets. */
export const seedSelectionSchema = z
  .object({
    stockItemId: z.string().min(1),
    cropPluginId: z.string().min(1),
    varietyDisplayName: z.string().min(1).max(160),
    quantityPlants: z.number().int().positive().max(1_000_000).optional(),
    /** #555: square feet a crop sown by area covers (sized at the high end
     *  of its sourced rate, or the farmer's own rate). */
    areaSqFt: z.number().positive().max(10_000_000).optional(),
    fillToBed: z.boolean().optional(),
    sunRequirement: z.enum(['full', 'partial', 'shade']).optional(),
    /** Phase 35 (R-15): keep this counted seed on one block for this run. */
    keepInOneBed: z.boolean().optional()
  })
  .refine(
    (s) => s.fillToBed === true || s.quantityPlants !== undefined || s.areaSqFt !== undefined,
    {
      message: 'quantityPlants or areaSqFt is required unless fillToBed is set',
      path: ['quantityPlants']
    }
  );

export type SeedSelection = z.infer<typeof seedSelectionSchema>;
