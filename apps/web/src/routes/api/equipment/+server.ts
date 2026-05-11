/**
 * GET  /api/equipment           — list all equipment (optional ?type=)
 * POST /api/equipment           — owner-only; create new equipment
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createEquipment, listEquipment, type EquipmentType } from '$lib/db/equipment';
import { requireOwner } from '$lib/server/auth';

const TYPES: EquipmentType[] = [
  'sprayer',
  'planter',
  'drill',
  'rake',
  'baler',
  'tractor',
  'mower',
  'irrigation',
  'other'
];

export const GET: RequestHandler = ({ url }) => {
  const t = url.searchParams.get('type');
  const filter = t && (TYPES as string[]).includes(t) ? { type: t as EquipmentType } : undefined;
  return json({ equipment: listEquipment(filter) });
};

const createSchema = z.object({
  type: z.enum(TYPES as [EquipmentType, ...EquipmentType[]]),
  typeId: z.string().min(1).optional(),
  label: z.string().min(1).max(120),
  spec: z.record(z.unknown()).optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  return json({ equipment: createEquipment(parsed.data) }, { status: 201 });
};
