/**
 * GET  /api/fields  — list all fields (Areas) with block-count + acres rollup;
 *                     `?kind=garden,greenhouse` filters by Area kind
 * POST /api/fields  — create a field (owner-only)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createField, listFields } from '$lib/db/fields';
import { requireOwner } from '$lib/server/auth';
import { MAX_SKETCH_FT } from '$lib/farm/sketch';
import { AREA_KINDS, validateAreaDetails } from '$lib/farm/areaKinds';
import { parseKindFilter } from '$lib/farm/kindFilter';

export const GET: RequestHandler = ({ url }) => {
  const kinds = parseKindFilter(url.searchParams.get('kind'), AREA_KINDS);
  if (kinds === 'invalid') return json({ error: 'unknown kind' }, { status: 400 });
  return json({ fields: listFields(kinds ? { kinds } : {}) });
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
  widthFt: z.number().positive().max(MAX_SKETCH_FT).optional(),
  lengthFt: z.number().positive().max(MAX_SKETCH_FT).optional(),
  geometryGeojson: geomSchema.optional(),
  kind: z.enum(AREA_KINDS).optional(),
  details: z.unknown().optional()
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
  const { geometryGeojson, kind = 'field', details: rawDetails, ...rest } = parsed.data;
  const details = validateAreaDetails(kind, rawDetails);
  if (!details.ok) {
    return json({ error: 'invalid details for kind', issues: details.issues }, { status: 400 });
  }
  const field = createField({
    ...rest,
    kind,
    details: details.details,
    geometryGeojson: geometryGeojson ? JSON.stringify(geometryGeojson) : undefined
  });
  return json({ field }, { status: 201 });
};
