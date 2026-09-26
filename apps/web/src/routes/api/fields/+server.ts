/**
 * GET  /api/fields  — list all fields (Areas) with block-count + acres rollup;
 *                     `?kind=garden,greenhouse` filters by Area kind
 * POST /api/fields  — create a field (owner-only)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { createField, listFields } from '$lib/db/fields';
import { requireOwner } from '$lib/server/auth';
import { fieldCreateSchema } from '$lib/farm/apiSchemas';
import { AREA_KINDS, validateAreaDetails } from '$lib/farm/areaKinds';
import { parseKindFilter } from '$lib/farm/kindFilter';

export const GET: RequestHandler = ({ url }) => {
  const kinds = parseKindFilter(url.searchParams.get('kind'), AREA_KINDS);
  if (kinds === 'invalid') return json({ error: 'unknown kind' }, { status: 400 });
  return json({ fields: listFields(kinds ? { kinds } : {}) });
};

export const _requestSchema = fieldCreateSchema;

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = fieldCreateSchema.safeParse(body);
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
