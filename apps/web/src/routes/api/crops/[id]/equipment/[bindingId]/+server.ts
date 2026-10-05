import { t } from '$lib/i18n';
/**
 * DELETE /api/crops/:id/equipment/:bindingId — unbind equipment from a crop
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { unbindEquipment } from '$lib/db/cropEquipment';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id || !event.params.bindingId)
    throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  const removed = unbindEquipment(event.params.bindingId);
  if (!removed) throw error(404, t(event.locals?.locale, 'api.err.bindingNotFound'));
  return json({ ok: true });
};
