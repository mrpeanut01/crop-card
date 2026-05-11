/**
 * PUT    /api/fields/:id/geometry — set or replace a field's GeoJSON boundary.
 * DELETE /api/fields/:id/geometry — clear it.
 *
 * Mirrors the blocks geometry endpoint exactly. Field boundaries are optional
 * visual overlays on the Layout map; blocks remain the authoritative geometry
 * for acreage and spray planning.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getField, updateField } from '$lib/db/fields';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const geomSchema = z.union([
  z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.unknown()
  }),
  z.object({
    type: z.literal('Feature'),
    geometry: z.object({
      type: z.enum(['Polygon', 'MultiPolygon']),
      coordinates: z.unknown()
    }),
    properties: z.unknown().optional()
  }),
  z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown())
  })
]);

export const PUT: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'field id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!getField(event.params.id)) throw error(404, 'field not found');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'invalid JSON');
  }
  const parsed = geomSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'expected GeoJSON Polygon / MultiPolygon / Feature / FeatureCollection',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const field = updateField(event.params.id, { geometryGeojson: JSON.stringify(parsed.data) });
  if (!field) throw error(404, 'field not found');
  return json({ field });
};

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'field id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const field = updateField(event.params.id, { geometryGeojson: null });
  if (!field) throw error(404, 'field not found');
  return json({ field });
};
