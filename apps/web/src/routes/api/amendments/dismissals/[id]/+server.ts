/** Phase 33C (M-49): the owner deletes a dismissal to bring the line back. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteDismissal, getDismissal } from '$lib/db/amendments';
import { requireOwner } from '$lib/server/auth';
import { refusal } from '$lib/server/amendmentRoutes';
import { t } from '$lib/i18n';

export const DELETE: RequestHandler = async (event) => {
  requireOwner(event);
  const dismissal = getDismissal(event.params.id ?? '');
  if (!dismissal)
    return refusal(404, 'NOT_FOUND', t(event.locals?.locale, 'amend.api.dismissalNotFound'));
  deleteDismissal(dismissal.id);
  return json({ deleted: dismissal.id });
};
