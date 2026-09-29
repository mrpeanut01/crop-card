import type { RequestHandler } from '@sveltejs/kit';
import { deleteInsecticideEvent } from '$lib/db/admin';
import { recordedAtOf } from '$lib/db/holdParams';
import { getInsecticideEvent } from '$lib/db/insecticideEvents';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5: the owner voids an insecticide application entered by mistake
 *  in the last 48 hours. It leaves a "never applied" tombstone. */
export const POST: RequestHandler = (event) => {
  const id = event.params.id ?? '';
  const existing = getInsecticideEvent(id);

  return voidRecord(
    event,
    existing ? { kind: 'insecticide', id, createdAtMs: recordedAtOf('insecticide', id) } : null,
    (input, by) =>
      deleteInsecticideEvent(id, {
        force: true,
        deletedBy: by,
        reason: input.reason,
        tombstone: true,
        neverApplied: true
      })
  );
};
