import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteEquipmentCascade } from '$lib/db/admin';
import { db } from '$lib/db/client';
import {
  appendEquipmentLog,
  getEquipment,
  listEquipmentLog,
  updateEquipment,
  updateEquipmentState
} from '$lib/db/equipment';
import { currentUser, requireOwner } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = ({ params, url }) => {
  if (!params.id) return json({ error: 'id required' }, { status: 400 });
  const equipment = getEquipment(params.id);
  if (!equipment) return json({ error: 'not found' }, { status: 404 });
  const logLimit = Number(url.searchParams.get('logLimit') ?? '50');
  const log = listEquipmentLog(params.id, { limit: logLimit });
  return json({ equipment, log });
};

const patchSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    notes: z.string().max(500).optional(),
    /** Sprayer tank size and nozzle; null clears one. */
    spec: z
      .object({
        tankGal: z.number().positive().max(10_000).nullable().optional(),
        nozzle: z.string().trim().max(80).nullable().optional()
      })
      .strict()
      .optional()
  })
  .refine((v) => v.label !== undefined || v.notes !== undefined || v.spec !== undefined, {
    message: 'at least one field required'
  });

function nozzleOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  if (!event.params.id) return json({ error: 'id required' }, { status: 400 });
  const existing = getEquipment(event.params.id);
  if (!existing) return json({ error: 'not found' }, { status: 404 });
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.spec !== undefined && existing.type !== 'sprayer') {
    return json({ error: 'tank and nozzle are for sprayers' }, { status: 400 });
  }
  const patch: Parameters<typeof updateEquipment>[1] = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label.trim();
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.spec !== undefined) patch.spec = parsed.data.spec;
  const id = event.params.id;
  const oldNozzle = nozzleOf(existing.spec?.nozzle);
  const nextNozzle =
    parsed.data.spec?.nozzle === undefined ? oldNozzle : nozzleOf(parsed.data.spec.nozzle);
  const nozzleChanged = oldNozzle !== nextNozzle;
  const clearCalibration = nozzleChanged && existing.state.calibratedGpa != null;
  const user = currentUser(event);
  const equipment = db.transaction(() => {
    const updated = updateEquipment(id, patch);
    if (clearCalibration) {
      updateEquipmentState(id, { calibratedGpa: null, calibrationDate: null });
      appendEquipmentLog({
        equipmentId: id,
        kind: 'calibration',
        performedById: user?.id,
        notes: `Nozzle changed${oldNozzle ? ` from ${oldNozzle}` : ''}${nextNozzle ? ` to ${nextNozzle}` : ''}. The old calibration (${existing.state.calibratedGpa} GPA) was cleared. Calibrate before the next spray.`,
        payload: {
          reason: 'nozzle-changed',
          previousGpa: existing.state.calibratedGpa,
          previousNozzle: oldNozzle,
          nozzle: nextNozzle
        }
      });
    }
    return updated;
  });
  return json({ equipment, calibrationCleared: clearCalibration });
};

/**
 * DELETE /api/equipment/:id
 *
 * Cascade-removes equipment_state, equipment_log, and pending_calibrations
 * for this row, nulls out tasks.equipment_id + insecticide_events.sprayerId,
 * then drops the equipment row itself.
 */
export const DELETE: RequestHandler = (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!event.params.id) return json({ error: 'id required' }, { status: 400 });
  const equipment = getEquipment(event.params.id);
  if (!equipment) return json({ error: 'not found' }, { status: 404 });
  const result = deleteEquipmentCascade(event.params.id);
  return json(result);
};
