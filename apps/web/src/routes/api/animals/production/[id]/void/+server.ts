import type { RequestHandler } from '@sveltejs/kit';
import { deleteProductionLog, getProductionLog } from '$lib/db/animalProduction';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5 (32G G4): the owner voids an eggs, milk or weight log entered by
 *  mistake in the last 48 hours. Its tombstone is marked voided, so the log
 *  no longer counts as food or sale covered by a hold. */
export const POST: RequestHandler = (event) => {
  const log = getProductionLog(event.params.id ?? '');
  return voidRecord(
    event,
    log ? { kind: 'animal-production', id: log.id, createdAtMs: log.createdAt } : null,
    (input, by) =>
      log && deleteProductionLog(log, { by, reason: input.reason, tombstone: true, voided: true })
  );
};
