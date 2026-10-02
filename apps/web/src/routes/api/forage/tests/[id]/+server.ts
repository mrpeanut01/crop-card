/** DELETE /api/forage/tests/:id (Phase 33C, M-60). Owner only; a typo's fix
 *  path. The lab report stays in the farm's documents. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteForageTest } from '$lib/db/forageTests';
import { requireUser } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  const user = requireUser(event);
  if (user.role !== 'owner') {
    return json(
      { error: 'OWNER_ONLY', message: 'Only the owner can delete a forage test. Ask the owner.' },
      { status: 403 }
    );
  }
  if (!deleteForageTest(event.params.id ?? '')) {
    return json(
      { error: 'NOT_FOUND', message: 'That forage test is not on this farm.' },
      { status: 404 }
    );
  }
  return json({ ok: true });
};
