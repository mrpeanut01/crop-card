/** DELETE /api/forage/tests/:id (Phase 33C, M-60). Owner only; a typo's fix
 *  path. The lab report stays in the farm's documents. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteForageTest } from '$lib/db/forageTests';
import { requireUser } from '$lib/server/auth';
import { t } from '$lib/i18n';

export const DELETE: RequestHandler = (event) => {
  const user = requireUser(event);
  if (user.role !== 'owner') {
    return json(
      { error: 'OWNER_ONLY', message: t(event.locals?.locale, 'forage.api.ownerDelete') },
      { status: 403 }
    );
  }
  if (!deleteForageTest(event.params.id ?? '')) {
    return json(
      { error: 'NOT_FOUND', message: t(event.locals?.locale, 'forage.api.notFound') },
      { status: 404 }
    );
  }
  return json({ ok: true });
};
