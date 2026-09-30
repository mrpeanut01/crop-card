/**
 * DELETE /api/irrigation/:id: remove a mistyped watering log (E4-13). The
 * owner, or the member who logged it. No lock and no tombstone: this is not
 * a compliance record.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteIrrigationEvent, getIrrigationEvent } from '$lib/db/irrigation';
import { requireUser } from '$lib/server/auth';
import { canRemoveLog } from '$lib/server/irrigationApi';

export const DELETE: RequestHandler = (event) => {
  const user = requireUser(event);
  const row = getIrrigationEvent(event.params.id ?? '');
  if (!row) return json({ error: 'No such watering log' }, { status: 404 });
  if (!canRemoveLog(user, row.performedById)) {
    return json(
      {
        error: 'Only the owner or the person who logged it can remove it. Ask the owner.',
        askOwner: true
      },
      { status: 403 }
    );
  }
  deleteIrrigationEvent(row.id);
  return json({ ok: true });
};
