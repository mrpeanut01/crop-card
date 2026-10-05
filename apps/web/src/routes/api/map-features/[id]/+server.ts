import { json, type RequestHandler } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import {
  deleteMapFeature,
  getMapFeature,
  updateMapFeature,
  type UpdateMapFeatureInput
} from '$lib/db/mapFeatures';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { mapFeaturePatchSchema } from '$lib/farm/apiSchemas';
import { parseFeatureGeometry, validateFeatureDetails } from '$lib/farm/mapFeatures';
import { checkAreaIds } from '$lib/server/mapFeatureAreaIds';
import { t } from '$lib/i18n';

export const GET: RequestHandler = ({ params, locals }) => {
  const mapFeature = params.id ? getMapFeature(params.id) : undefined;
  if (!mapFeature)
    return json({ error: t(locals?.locale, 'stockui.api.notFound') }, { status: 404 });
  return json({ mapFeature });
};

export const _requestSchema = mapFeaturePatchSchema;

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  const id = event.params.id;
  const existing = id ? getMapFeature(id) : undefined;
  if (!id || !existing)
    return json({ error: t(event.locals?.locale, 'stockui.api.notFound') }, { status: 404 });
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
  const patch: UpdateMapFeatureInput = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.geometry !== undefined) {
    const geom = parseFeatureGeometry(existing.kind, parsed.data.geometry, event.locals?.locale);
    if (!geom.ok) return json({ error: geom.message }, { status: 400 });
    patch.geometry = geom.geometry;
  }
  if ('details' in parsed.data) {
    const details = validateFeatureDetails(
      existing.kind,
      parsed.data.details,
      event.locals?.locale
    );
    if (!details.ok) return json({ error: details.message }, { status: 400 });
    patch.details = details.details;
  }
  if (parsed.data.fieldId !== undefined) {
    const foreign = rejectForeignRefsIn(event.locals?.locale, [
      'fieldId',
      parsed.data.fieldId,
      getField
    ]);
    if (foreign) return foreign;
    patch.fieldId = parsed.data.fieldId;
  }
  if (parsed.data.areaIds !== undefined) {
    const bad = checkAreaIds(existing.kind, parsed.data.areaIds, event.locals?.locale);
    if (bad) return bad;
    patch.areaIds = parsed.data.areaIds;
    delete patch.fieldId;
  }
  return json({ mapFeature: updateMapFeature(id, patch) });
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id || !deleteMapFeature(id))
    return json({ error: t(event.locals?.locale, 'stockui.api.notFound') }, { status: 404 });
  return json({ ok: true });
};
