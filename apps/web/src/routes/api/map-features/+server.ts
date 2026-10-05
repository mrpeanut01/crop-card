import { json, type RequestHandler } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { createMapFeature, listMapFeatures } from '$lib/db/mapFeatures';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { parseKindFilter } from '$lib/farm/kindFilter';
import { mapFeatureCreateSchema } from '$lib/farm/apiSchemas';
import {
  MAP_FEATURE_KINDS,
  parseFeatureGeometry,
  servesManyAreas,
  validateFeatureDetails
} from '$lib/farm/mapFeatures';
import { checkAreaIds } from '$lib/server/mapFeatureAreaIds';
import { t } from '$lib/i18n';

export const GET: RequestHandler = ({ url, locals }) => {
  const kinds = parseKindFilter(url.searchParams.get('kind'), MAP_FEATURE_KINDS);
  if (kinds === 'invalid')
    return json({ error: t(locals?.locale, 'api.errB.unknownKind') }, { status: 400 });
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
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = _requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { kind, name, fieldId } = parsed.data;
  const geom = parseFeatureGeometry(kind, parsed.data.geometry, event.locals?.locale);
  if (!geom.ok) return json({ error: geom.message }, { status: 400 });
  const details = validateFeatureDetails(kind, parsed.data.details, event.locals?.locale);
  if (!details.ok) return json({ error: details.message }, { status: 400 });
  const foreign = rejectForeignRefsIn(event.locals?.locale, ['fieldId', fieldId, getField]);
  if (foreign) return foreign;
  const areaIds = parsed.data.areaIds;
  if (areaIds !== undefined) {
    const bad = checkAreaIds(kind, areaIds, event.locals?.locale);
    if (bad) return bad;
  }
  const mapFeature = createMapFeature({
    kind,
    name,
    geometry: geom.geometry,
    fieldId: fieldId ?? null,
    details: details.details,
    ...(areaIds !== undefined && servesManyAreas(kind) ? { areaIds } : {})
  });
  return json({ mapFeature }, { status: 201 });
};
