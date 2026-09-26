import { json, type RequestHandler } from '@sveltejs/kit';
import { createBlock, listBlocks } from '$lib/db/blocks';
import { blockCreateSchema } from '$lib/farm/apiSchemas';
import { BLOCK_KINDS, DEFAULT_BLOCK_KIND, defaultBlockKindFor } from '$lib/farm/areaKinds';
import { blockPlacementError } from '$lib/farm/blockLayout';
import { parseKindFilter } from '$lib/farm/kindFilter';
import { getField } from '$lib/db/fields';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { bedLayoutProblem } from '$lib/server/garden/bedLayout';

export const GET: RequestHandler = ({ url }) => {
  const kinds = parseKindFilter(url.searchParams.get('kind'), BLOCK_KINDS);
  if (kinds === 'invalid') return json({ error: 'unknown kind' }, { status: 400 });
  return json({ blocks: listBlocks(kinds ? { kinds } : {}) });
};

export const _requestSchema = blockCreateSchema;

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = blockCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const foreign = rejectForeignRefs(['fieldId', parsed.data.fieldId, getField]);
  if (foreign) return foreign;
  const area = parsed.data.fieldId ? getField(parsed.data.fieldId) : undefined;
  const kind = parsed.data.kind ?? (area ? defaultBlockKindFor(area.kind) : DEFAULT_BLOCK_KIND);
  const placement = blockPlacementError(area?.kind ?? null, kind, parsed.data);
  if (placement) return json({ error: placement }, { status: 400 });
  const layoutProblem = bedLayoutProblem({
    id: '',
    name: parsed.data.name,
    kind: parsed.data.kind ?? DEFAULT_BLOCK_KIND,
    fieldId: parsed.data.fieldId,
    widthFt: parsed.data.widthFt,
    lengthFt: parsed.data.lengthFt,
    xFt: parsed.data.xFt,
    yFt: parsed.data.yFt,
    rotationDeg: parsed.data.rotationDeg
  });
  if (layoutProblem) return json(layoutProblem, { status: 409 });
  const { geometryGeojson, ...rest } = parsed.data;
  const block = createBlock({
    ...rest,
    kind,
    geometryGeojson: geometryGeojson ? JSON.stringify(geometryGeojson) : undefined
  });
  return json({ block }, { status: 201 });
};
