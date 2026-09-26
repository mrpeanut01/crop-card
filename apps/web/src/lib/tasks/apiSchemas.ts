import { z } from 'zod';

/** Body of `POST /api/tasks/close`, the offline replay of a Done or Skip. */
export const taskCloseSchema = z.object({
  taskId: z.string().min(1).max(200),
  action: z.enum(['complete', 'abort']),
  reason: z.string().max(500).optional(),
  occurredAt: z.number().int().positive().optional()
});
