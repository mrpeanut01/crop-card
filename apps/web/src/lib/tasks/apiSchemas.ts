import { z } from 'zod';
import { healthRecordSchema } from '$lib/animals/recordApiSchemas';
import { SNOOZE_DAYS, isYmd } from '$lib/animals/carePlans';

/** Body of `POST /api/tasks/close`, the offline replay of a Done or Skip.
 *  An animal-care task (32D) may carry the treatment it records
 *  (`healthEvent`, the same body as `POST /api/animals/health/record`), the
 *  owner's next due day, and on Skip whether to skip this one or be
 *  reminded again in a few days. */
export const taskCloseSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    action: z.enum(['complete', 'abort']),
    reason: z.string().max(500).optional(),
    occurredAt: z.number().int().positive().optional(),
    healthEvent: healthRecordSchema.optional(),
    nextDueOn: z.string().refine(isYmd, 'use YYYY-MM-DD').optional(),
    careSkip: z.enum(['skip-this', 'snooze']).optional(),
    snoozeDays: z
      .number()
      .int()
      .refine((n) => (SNOOZE_DAYS as readonly number[]).includes(n), 'snooze 1, 3 or 7 days')
      .optional()
  })
  .refine((v) => v.careSkip !== 'snooze' || v.snoozeDays !== undefined, {
    message: 'say how many days to wait',
    path: ['snoozeDays']
  });
export type TaskCloseInput = z.infer<typeof taskCloseSchema>;
