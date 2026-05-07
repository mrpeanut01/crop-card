/**
 * POST /api/sprayers/:id/calibration
 *
 * Persists a 1/128-acre method calibration result for the sprayer
 * (UC-10, FR-12). Owner-only — calibration changes affect every dilution
 * computation downstream.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getSprayer, recordCalibration } from '$lib/server/sprayers';

const requestSchema = z.object({
  calibratedGpa: z.number().positive(),
  spreadInches: z.number().positive().optional(),
  ouncesCollected: z.number().nonnegative().optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);

  const id = event.params.id;
  if (!id || !getSprayer(id)) {
    return json({ error: 'unknown sprayer id' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const sprayer = recordCalibration(id, parsed.data.calibratedGpa);
  return json({ sprayer });
};
