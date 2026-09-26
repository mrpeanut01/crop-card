import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getField } from '$lib/db/fields';
import {
  deleteMapFeature,
  getMapFeature,
  updateMapFeature,
  type UpdateMapFeatureInput
} from '$lib/db/mapFeatures';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { parseFeatureGeometry, validateFeatureDetails } from '$lib/farm/mapFeatures';

export const GET: RequestHandler = ({ params }) => {
  const mapFeature = params.id ? getMapFeature(params.id) : undefined;
  if (!mapFeature) return json({ error: 'not found' }, { status: 404 });
  return json({ mapFeature });
};

export const _requestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  geometry: z.unknown().optional(),
  fieldId: z.string().min(1).nullable().optional(),
  details: z.unknown().optional()
});

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  const id = event.params.id;
  const existing = id ? getMapFeature(id) : undefined;
  if (!id || !existing) return json({ error: 'not found' }, { status: 404 });
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = _requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const patch: UpdateMapFeatureInput = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.geometry !== undefined) {
    const geom = parseFeatureGeometry(existing.kind, parsed.data.geometry);
    if (!geom.ok) return json({ error: geom.message }, { status: 400 });
    patch.geometry = geom.geometry;
  }
  if ('details' in parsed.data) {
    const details = validateFeatureDetails(existing.kind, parsed.data.details);
    if (!details.ok) return json({ error: details.message }, { status: 400 });
    patch.details = details.details;
  }
  if (parsed.data.fieldId !== undefined) {
    const foreign = rejectForeignRefs(['fieldId', parsed.data.fieldId, getField]);
    if (foreign) return foreign;
    patch.fieldId = parsed.data.fieldId;
  }
  return json({ mapFeature: updateMapFeature(id, patch) });
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id || !deleteMapFeature(id)) return json({ error: 'not found' }, { status: 404 });
  return json({ ok: true });
};
