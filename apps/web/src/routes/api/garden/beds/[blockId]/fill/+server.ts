import { json, type RequestHandler } from '@sveltejs/kit';
import { fillRequestSchema } from '$lib/garden/api';
import type { CropPlugin } from '$lib/plugins/schemas';
import { requireOwner } from '$lib/server/auth';
import { fillBed, loadFillInputs } from '$lib/server/garden/fill';
import { failureResponse, isFailure, resolveDesignableBed } from '$lib/server/garden/placement';
import { getBedRecipes, getRegistry } from '$lib/server/registry';

export const _requestSchema = fillRequestSchema;

/** POST /api/garden/beds/[blockId]/fill. Proposals for the bed's free space
 *  from Claude when it is available, else from the best-fitting bed recipe
 *  or the owner's planned crops. Never saves anything. */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = fillRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const bed = resolveDesignableBed(event.params.blockId ?? '');
  if (isFailure(bed)) return failureResponse(bed);

  const registry = await getRegistry();
  const crops: Record<string, CropPlugin> = {};
  for (const crop of registry.crops()) crops[crop.pluginId] = crop;
  const recipes = (await getBedRecipes()).all();

  const inputs = loadFillInputs(bed, parsed.data, crops, recipes);
  return json(await fillBed({ userId: user.id, bed, req: parsed.data, inputs }));
};
