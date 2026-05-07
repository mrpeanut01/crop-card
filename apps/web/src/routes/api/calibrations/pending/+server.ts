/**
 * GET /api/calibrations/pending — owner reviews helper-submitted calibrations.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { listPendingCalibrations } from '$lib/server/pendingCalibrations';

export const GET: RequestHandler = (event) => {
  requireOwner(event);
  return json({ pending: listPendingCalibrations() });
};
