/** Phase 33C (M-36): the owner removes an input added by mistake. */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteBatchInput, getBatch, getBatchInput } from '$lib/db/amendments';
import { requireOwner } from '$lib/server/auth';
import { loadCarryoverData } from '$lib/server/amendmentChain';
import { batchView, dayContext, refusal } from '$lib/server/amendmentRoutes';
import { t } from '$lib/i18n';

export const DELETE: RequestHandler = async (event) => {
  requireOwner(event);
  const batch = getBatch(event.params.id ?? '');
  const input = getBatchInput(event.params.inputId ?? '');
  if (!batch || !input || input.batchId !== batch.id) {
    return refusal(404, 'NOT_FOUND', t(event.locals?.locale, 'amend.api.inputNotFound'));
  }
  deleteBatchInput(input.id);
  const data = await loadCarryoverData();
  return json({ batch: batchView(data, batch, dayContext().timeZone) });
};
