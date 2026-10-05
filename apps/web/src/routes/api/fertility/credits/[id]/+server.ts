import { t } from '$lib/i18n';
/** DELETE /api/fertility/credits/:id */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteFertilityCredit } from '$lib/db/admin';
import { requireOwner } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  return json(deleteFertilityCredit(event.params.id));
};
