/**
 * GET    /api/fields/:id  — fetch one field
 * PATCH  /api/fields/:id  — edit name/acres/location/notes/geometry
 * DELETE /api/fields/:id  — cascade through every block + crop + event
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteFieldCascade } from '$lib/db/admin';
import { getField, updateField } from '$lib/db/fields';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const field = getField(params.id);
  if (!field) throw error(404, 'field not found');
  return json({ field });
};

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  acres: z.number().positive().nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  geometryGeojson: z.string().nullable().optional()
});

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!getField(event.params.id)) throw error(404, 'field not found');

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
  const field = updateField(event.params.id, parsed.data);
  return json({ field });
};

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!getField(event.params.id)) throw error(404, 'field not found');
  return json(deleteFieldCascade(event.params.id));
};
