import { t } from '$lib/i18n';
/**
 * DELETE /api/fertility/applications/:id — remove the application + any
 * stock_movements that point at it.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteFertilityApplication } from '$lib/db/admin';
import { requireOwner } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  return json(deleteFertilityApplication(event.params.id));
};
