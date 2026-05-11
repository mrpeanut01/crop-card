/**
 * GET  /api/fields  — list all fields with block-count + acres rollup
 * POST /api/fields  — create a field (owner-only)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createField, listFields } from '$lib/db/fields';
import { requireOwner } from '$lib/server/auth';

export const GET: RequestHandler = () => {
  return json({ fields: listFields() });
};

const geomSchema = z.union([
  z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.unknown() }),
  z.object({
    type: z.literal('Feature'),
    geometry: z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.unknown() }),
    properties: z.unknown().optional()
  }),
  z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) })
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  acres: z.number().positive().optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  geometryGeojson: geomSchema.optional()
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
  const { geometryGeojson, ...rest } = parsed.data;
  const field = createField({
    ...rest,
    geometryGeojson: geometryGeojson ? JSON.stringify(geometryGeojson) : undefined
  });
  return json({ field }, { status: 201 });
};
