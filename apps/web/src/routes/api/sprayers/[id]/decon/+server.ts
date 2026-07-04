/**
 * POST /api/sprayers/:id/decon
 *
 * Records a completed decontamination for the given sprayer. Called from the
 * decon wizard's final confirmation step (FR-05, UC-04).
 *
 * Owner-only: clearing contamination state is a safety-state mutation
 * (Invariant 8) — a helper must not be able to reset decon history.
 *
 * Server enforces the timestamp; client can't fabricate decon history.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { getSprayer, recordDecon } from '$lib/server/sprayers';

export const POST: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id || !getSprayer(id)) {
    return json({ error: 'unknown sprayer id' }, { status: 404 });
  }
  const updated = recordDecon(id, Date.now());
  return json({ sprayer: updated });
};
