import { z } from 'zod';
import { MAX_FEED_USE_LB } from './animalStock';

/** POST /api/stock/{id}/use (Phase 32D, D0-12). Feed or bedding taken off
 *  stock, typed in pounds (a scoop chip sends its pounds). Helpers can
 *  record it; it replays from the offline queue with a client record id. */
export const feedUseSchema = z
  .object({
    lb: z.number().positive().max(MAX_FEED_USE_LB),
    subjectType: z.enum(['animal', 'group']).optional(),
    subjectId: z.string().min(1).max(80).optional(),
    occurredAt: z.number().int().positive().optional()
  })
  .strict()
  .refine((b) => !b.subjectType === !b.subjectId, {
    message: 'subjectType and subjectId go together',
    path: ['subjectId']
  });

export type FeedUseInput = z.infer<typeof feedUseSchema>;
