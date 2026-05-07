/**
 * PUT /api/blocks/:id/geometry — set or replace a block's GeoJSON polygon.
 * DELETE /api/blocks/:id/geometry — clear it.
 *
 * Phase 10 GPS-mapping stub. Geometry is stored as a JSON string; we
 * validate it parses + has a top-level type of Polygon / MultiPolygon /
 * Feature(Polygon|MultiPolygon). No PostGIS — /map renders an SVG fallback.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { setBlockGeometry } from '$lib/db/blocks';

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

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!params.id) throw error(400, 'block id required');
  let body: unknown;
  try {
    body = await request.json();
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
  const block = setBlockGeometry(params.id, JSON.stringify(parsed.data));
  if (!block) throw error(404, 'block not found');
  return json({ block });
};

export const DELETE: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'block id required');
  const block = setBlockGeometry(params.id, null);
  if (!block) throw error(404, 'block not found');
  return json({ block });
};
