import type { RequestHandler } from '@sveltejs/kit';
import { getCutting, voidCutting } from '$lib/db/hayCuttings';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5 (32G G4): the owner voids a hay cutting entered by mistake in
 *  the last 48 hours. It leaves a voided tombstone. */
export const POST: RequestHandler = (event) => {
  const cutting = getCutting(event.params.id ?? '');
  return voidRecord(
    event,
    cutting ? { kind: 'hay', id: cutting.id, createdAtMs: cutting.createdAt } : null,
    (input, by) => voidCutting(cutting!.id, { by, reason: input.reason })
  );
};
