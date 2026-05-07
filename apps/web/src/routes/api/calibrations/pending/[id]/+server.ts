/**
 * Owner-only endpoints for reviewing helper-submitted calibrations.
 *
 * POST   /api/calibrations/pending/:id   — approve (apply + delete)
 * DELETE /api/calibrations/pending/:id   — reject (delete only)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import {
  approvePendingCalibration,
  getPendingCalibration,
  rejectPendingCalibration
} from '$lib/server/pendingCalibrations';

export const POST: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id || !getPendingCalibration(id)) {
    return json({ error: 'unknown pending calibration' }, { status: 404 });
  }
  approvePendingCalibration(id);
  return json({ status: 'approved' });
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id || !getPendingCalibration(id)) {
    return json({ error: 'unknown pending calibration' }, { status: 404 });
  }
  rejectPendingCalibration(id);
  return json({ status: 'rejected' });
};
