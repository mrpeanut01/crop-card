import type { RequestHandler } from '@sveltejs/kit';
import { getStatusEvent } from '$lib/db/animalStatus';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { undoStatus } from '$lib/server/animals';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5 (32G G4): the owner voids a status change entered by mistake in
 *  the last 48 hours. It runs the undo path (latest change only), and the
 *  tombstone is marked voided so a slaughter or sale no longer counts. */
export const POST: RequestHandler = (event) => {
  const status = getStatusEvent(event.params.id ?? '');
  return voidRecord(
    event,
    status ? { kind: 'animal-status', id: status.id, createdAtMs: status.createdAt } : null,
    (input, by) => undoStatus(status!.id, Date.now(), by, { reason: input.reason })
  );
};
