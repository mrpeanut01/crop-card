import { json, type RequestHandler } from '@sveltejs/kit';
import { successionRequestSchema } from '$lib/garden/api';
import type { CropPlugin } from '$lib/plugins/schemas';
import { requireOwner } from '$lib/server/auth';
import { failureResponse, isFailure } from '$lib/server/garden/placement';
import { addSuccession } from '$lib/server/garden/succession';
import { getRegistry } from '$lib/server/registry';

export const _requestSchema = successionRequestSchema;

/** POST /api/garden/beds/[blockId]/succession. `commit: false` previews;
 *  `commit: true` links the sowings that fit to the planting as one
 *  succession group. */
export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = successionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const registry = await getRegistry();
  const crops: Record<string, CropPlugin> = {};
  for (const crop of registry.crops()) crops[crop.pluginId] = crop;
  const result = addSuccession(event.params.blockId ?? '', parsed.data, crops);
  if (isFailure(result)) return failureResponse(result);
  return json(result.response, { status: parsed.data.commit ? 201 : 200 });
};
