import { z } from 'zod';
import { MAX_FEED_USE_LB } from './animalStock';
import {
  isValidYmd,
  MAX_SOURCES_CHECKED,
  RESULT_MAX,
  SEED_ORGANIC_STATUSES,
  SUPPLIER_MAX,
  UNAVAILABILITY_NOTE_MAX
} from './seedSourcing';

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

const trimmed = (min: number, max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.trim())
    .pipe(z.string().min(min).max(max));

/** PATCH /api/stock/{id}/lots/{lotId}/seed-sourcing (33B, B-37, B-38).
 *  Owner only; replaces all three fields at once. `checkedAt` must also
 *  not be after the farm's today, which the route checks. */
export const seedSourcingPatchSchema = z
  .object({
    status: z.enum(SEED_ORGANIC_STATUSES).nullable(),
    sourcesChecked: z
      .array(
        z
          .object({
            supplier: trimmed(1, SUPPLIER_MAX),
            checkedAt: z.string().refine(isValidYmd, 'use YYYY-MM-DD'),
            result: trimmed(1, RESULT_MAX)
          })
          .strict()
      )
      .max(MAX_SOURCES_CHECKED),
    unavailabilityNote: z
      .string()
      .max(UNAVAILABILITY_NOTE_MAX * 4)
      .transform((s) => s.trim())
      .pipe(z.string().max(UNAVAILABILITY_NOTE_MAX))
      .nullable()
      .transform((s) => (s ? s : null))
  })
  .strict();

export type SeedSourcingPatch = z.infer<typeof seedSourcingPatchSchema>;
