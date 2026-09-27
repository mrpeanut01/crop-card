import type { RequestHandler } from '@sveltejs/kit';
import { deleteSprayEvent } from '$lib/db/admin';
import { recordedAtOf } from '$lib/db/holdParams';
import { getSprayEvent } from '$lib/db/sprayEvents';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5: the owner voids a spray entered by mistake in the last 48
 *  hours. It leaves a "never applied" tombstone. */
export const POST: RequestHandler = (event) => {
  const id = event.params.id ?? '';
  const existing = getSprayEvent(id);
  const createdAt = existing ? (recordedAtOf('spray', id) ?? existing.occurredAt) : null;
  return voidRecord(
    event,
    createdAt === null ? null : { kind: 'spray', id, createdAtMs: createdAt },
    (input, by) =>
      deleteSprayEvent(id, {
        force: true,
        deletedBy: by,
        reason: input.reason,
        tombstone: true,
        neverApplied: true
      })
  );
};
