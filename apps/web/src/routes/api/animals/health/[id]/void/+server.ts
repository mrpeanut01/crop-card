import type { RequestHandler } from '@sveltejs/kit';
import { deleteHealthEvent, getHealthEvent } from '$lib/db/animalHealth';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5: the owner voids a dose entered by mistake in the last 48
 *  hours. The record leaves a "never given" tombstone. */
export const POST: RequestHandler = (event) => {
  const record = getHealthEvent(event.params.id ?? '');
  return voidRecord(
    event,
    record ? { kind: 'animal-health', id: record.id, createdAtMs: record.createdAt } : null,
    (input, by) =>
      record && deleteHealthEvent(record, { deletedBy: by, reason: input.reason, dosed: false })
  );
};
