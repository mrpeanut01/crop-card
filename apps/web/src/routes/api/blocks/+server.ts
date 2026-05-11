import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createBlock, listBlocks } from '$lib/db/blocks';
import { requireOwner } from '$lib/server/auth';

export const GET: RequestHandler = () => {
  return json({ blocks: listBlocks() });
};

// Phase 13b: optional GeoJSON polygon at create time so the Layout map can
// draw → name → save in one round-trip. Same shape the dedicated geometry
// endpoint accepts.
const geomSchema = z.union([
  z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.unknown() }),
  z.object({
    type: z.literal('Feature'),
    geometry: z.object({
      type: z.enum(['Polygon', 'MultiPolygon']),
      coordinates: z.unknown()
    }),
    properties: z.unknown().optional()
  }),
  z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) })
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  acres: z.number().positive().optional(),
  blockLabel: z.string().max(60).optional(),
  fieldId: z.string().min(1).optional(),
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
  const block = createBlock({
    ...rest,
    geometryGeojson: geometryGeojson ? JSON.stringify(geometryGeojson) : undefined
  });
  return json({ block }, { status: 201 });
};
