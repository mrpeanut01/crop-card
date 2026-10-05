/**
 * POST /api/sprayers/:id/calibration
 *
 * Persists a 1/128-acre method calibration result for the sprayer
 * (UC-10, FR-12).
 *
 * Owner: writes directly to the equipment row (calibration is owner-gated
 *   because it scales every dilution computation downstream).
 * Helper (F-M): writes to pending_calibrations for owner review. The owner
 *   approves via /api/calibrations/pending/:id/approve.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth';
import { getSprayer, recordCalibration } from '$lib/server/sprayers';
import { submitPendingCalibration } from '$lib/server/pendingCalibrations';
import { t } from '$lib/i18n';

const requestSchema = z.object({
  calibratedGpa: z.number().min(0.5).max(200),
  spreadInches: z.number().positive().optional(),
  ouncesCollected: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);

  const id = event.params.id;
  if (!id || !getSprayer(id)) {
    return json({ error: t(event.locals?.locale, 'api.errB.unknownSprayerId') }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (user.role === 'owner') {
    const sprayer = recordCalibration(id, parsed.data.calibratedGpa);
    return json({ sprayer, status: 'applied' });
  }

  const pending = submitPendingCalibration({
    equipmentId: id,
    submittedById: user.id,
    calibratedGpa: parsed.data.calibratedGpa,
    spreadInches: parsed.data.spreadInches,
    ouncesCollected: parsed.data.ouncesCollected,
    notes: parsed.data.notes
  });
  return json({ pending, status: 'pending-owner-review' }, { status: 202 });
};
