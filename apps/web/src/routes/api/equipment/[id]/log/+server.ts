/**
 * POST /api/equipment/:id/log — append a maintenance / inspection / note entry.
 * Sprayer-specific kinds (decon, calibration, use) are written by the
 * sprayer/calibrate flows; this endpoint is for the general log.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { appendEquipmentLog, getEquipment } from '$lib/db/equipment';
import { requireUser } from '$lib/server/auth';

const schema = z.object({
  kind: z.enum(['maintenance', 'inspection', 'note']),
  occurredAt: z.number().int().optional(),
  notes: z.string().max(500).optional(),
  payload: z.record(z.unknown()).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  const id = event.params.id;
  if (!id || !getEquipment(id)) return json({ error: 'not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const entry = appendEquipmentLog({
    equipmentId: id,
    kind: parsed.data.kind,
    occurredAt: parsed.data.occurredAt,
    performedById: user.id,
    notes: parsed.data.notes,
    payload: parsed.data.payload
  });
  return json({ entry }, { status: 201 });
};
