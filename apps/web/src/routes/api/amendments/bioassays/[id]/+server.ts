/** Phase 33C (M-49): the owner removes a pea or bean test entered by mistake. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteBioassay, getBioassay } from '$lib/db/amendments';
import { requireOwner } from '$lib/server/auth';
import { refusal } from '$lib/server/amendmentRoutes';
import { t } from '$lib/i18n';

export const DELETE: RequestHandler = async (event) => {
  requireOwner(event);
  const bioassay = getBioassay(event.params.id ?? '');
  if (!bioassay)
    return refusal(404, 'NOT_FOUND', t(event.locals?.locale, 'amend.api.testNotFound'));
  deleteBioassay(bioassay.id);
  return json({ deleted: bioassay.id });
};
