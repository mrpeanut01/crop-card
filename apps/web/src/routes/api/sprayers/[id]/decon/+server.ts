/**
 * POST /api/sprayers/:id/decon
 *
 * Records a completed decontamination for the given sprayer. Called from the
 * decon wizard's final confirmation step (FR-05, UC-04).
 *
 * Server enforces the timestamp; client can't fabricate decon history.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getSprayer, recordDecon } from '$lib/server/sprayers';

export const POST: RequestHandler = ({ params }) => {
  const id = params.id;
  if (!id || !getSprayer(id)) {
    return json({ error: 'unknown sprayer id' }, { status: 404 });
  }
  const updated = recordDecon(id, Date.now());
  return json({ sprayer: updated });
};
