import { z } from 'zod';
import { MAX_REASON } from './model';

/** C-35 §5: `POST …/[id]/void`. The first call answers 409 with the diff
 *  and its hash; the owner resubmits with `confirmShorten` set to it. */
export const holdVoidSchema = z.object({
  reason: z.string().trim().min(1, 'Say why this entry is being voided.').max(MAX_REASON),
  confirmShorten: z.string().regex(/^[0-9a-f]{64}$/).optional()
});

export type HoldVoidInput = z.infer<typeof holdVoidSchema>;
