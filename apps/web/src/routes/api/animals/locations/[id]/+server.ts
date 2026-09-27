import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { deleteLatestStay } from '$lib/db/animalLocations';
import { requireOwner } from '$lib/server/auth';

/** Owner only: removes a subject's latest move and reopens the stay before
 *  it. Helpers correct a move by moving the animals back. */
export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const result = db.transaction(() => deleteLatestStay(event.params.id ?? ''));
  if (result.ok) return json({ ok: true, reopened: result.reopened });
  if (result.reason === 'not-found') return json({ error: 'move not found' }, { status: 404 });
  return json(
    result.reason === 'not-latest'
      ? { error: 'Only the latest move can be removed.', code: 'NOT_LATEST' }
      : {
          error: 'This move changed a group. Move the animal again instead.',
          code: 'GROUP_CHANGE'
        },
    { status: 409 }
  );
};
