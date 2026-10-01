import type { RequestHandler } from '@sveltejs/kit';
import { deleteFungicideEvent } from '$lib/db/admin';
import { recordedAtOf } from '$lib/db/holdParams';
import { getFungicideEvent } from '$lib/db/fungicideEvents';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5 (32G G4): the owner voids a fungicide application entered by
 *  mistake in the last 48 hours. It leaves a "never applied" tombstone. */
export const POST: RequestHandler = (event) => {
  const id = event.params.id ?? '';
  const existing = getFungicideEvent(id);

  return voidRecord(
    event,
    existing ? { kind: 'fungicide', id, createdAtMs: recordedAtOf('fungicide', id) } : null,
    (input, by) =>
      deleteFungicideEvent(id, {
        force: true,
        deletedBy: by,
        reason: input.reason,
        tombstone: true,
        neverApplied: true
      })
  );
};
