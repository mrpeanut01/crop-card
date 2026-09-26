import { json, type RequestHandler } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { createMapFeature, listMapFeatures } from '$lib/db/mapFeatures';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { parseKindFilter } from '$lib/farm/kindFilter';
import { mapFeatureCreateSchema } from '$lib/farm/apiSchemas';
import {
  MAP_FEATURE_KINDS,
  parseFeatureGeometry,
  validateFeatureDetails
} from '$lib/farm/mapFeatures';

export const GET: RequestHandler = ({ url }) => {
  const kinds = parseKindFilter(url.searchParams.get('kind'), MAP_FEATURE_KINDS);
  if (kinds === 'invalid') return json({ error: 'unknown kind' }, { status: 400 });
  const fieldId = url.searchParams.get('fieldId') ?? undefined;
  const all = listMapFeatures({ fieldId });
  return json({ mapFeatures: kinds ? all.filter((f) => kinds.includes(f.kind)) : all });
};

export const _requestSchema = mapFeatureCreateSchema;

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
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
  const { kind, name, fieldId } = parsed.data;
  const geom = parseFeatureGeometry(kind, parsed.data.geometry);
  if (!geom.ok) return json({ error: geom.message }, { status: 400 });
  const details = validateFeatureDetails(kind, parsed.data.details);
  if (!details.ok) return json({ error: details.message }, { status: 400 });
  const foreign = rejectForeignRefs(['fieldId', fieldId, getField]);
  if (foreign) return foreign;
  const mapFeature = createMapFeature({
    kind,
    name,
    geometry: geom.geometry,
    fieldId: fieldId ?? null,
    details: details.details
  });
  return json({ mapFeature }, { status: 201 });
};
