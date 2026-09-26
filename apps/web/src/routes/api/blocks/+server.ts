import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createBlock, listBlocks } from '$lib/db/blocks';
import { MAX_SKETCH_FT } from '$lib/farm/sketch';
import { BLOCK_KINDS, DEFAULT_BLOCK_KIND, defaultBlockKindFor } from '$lib/farm/areaKinds';
import { blockLayoutSchema, blockPlacementError } from '$lib/farm/blockLayout';
import { parseKindFilter } from '$lib/farm/kindFilter';
import { getField } from '$lib/db/fields';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';

export const GET: RequestHandler = ({ url }) => {
  const kinds = parseKindFilter(url.searchParams.get('kind'), BLOCK_KINDS);
  if (kinds === 'invalid') return json({ error: 'unknown kind' }, { status: 400 });
  return json({ blocks: listBlocks(kinds ? { kinds } : {}) });
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

const createSchema = blockLayoutSchema.extend({
  name: z.string().min(1).max(120),
  acres: z.number().positive().optional(),
  blockLabel: z.string().max(60).optional(),
  fieldId: z.string().min(1).optional(),
  widthFt: z.number().positive().max(MAX_SKETCH_FT).optional(),
  lengthFt: z.number().positive().max(MAX_SKETCH_FT).optional(),
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
  const foreign = rejectForeignRefs(['fieldId', parsed.data.fieldId, getField]);
  if (foreign) return foreign;
  const area = parsed.data.fieldId ? getField(parsed.data.fieldId) : undefined;
  const kind = parsed.data.kind ?? (area ? defaultBlockKindFor(area.kind) : DEFAULT_BLOCK_KIND);
  const placement = blockPlacementError(area?.kind ?? null, kind, parsed.data);
  if (placement) return json({ error: placement }, { status: 400 });
  const { geometryGeojson, ...rest } = parsed.data;
  const block = createBlock({
    ...rest,
    kind,
    geometryGeojson: geometryGeojson ? JSON.stringify(geometryGeojson) : undefined
  });
  return json({ block }, { status: 201 });
};
