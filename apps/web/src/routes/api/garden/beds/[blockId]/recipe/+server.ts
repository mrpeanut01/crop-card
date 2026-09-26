import { json, type RequestHandler } from '@sveltejs/kit';
import { recipeRequestSchema } from '$lib/garden/api';
import type { CropPlugin } from '$lib/plugins/schemas';
import { requireOwner } from '$lib/server/auth';
import { failureResponse, isFailure } from '$lib/server/garden/placement';
import { applyBedRecipe } from '$lib/server/garden/recipe';
import { getBedRecipes, getRegistry } from '$lib/server/registry';

export const _requestSchema = recipeRequestSchema;

/** POST /api/garden/beds/[blockId]/recipe. `commit: false` previews the
 *  recipe on the bed as stored; `commit: true` saves the kept steps as
 *  planned plantings in one go, or nothing when any of them no longer fits. */
export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = recipeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const registry = await getRegistry();
  const crops: Record<string, CropPlugin> = {};
  for (const crop of registry.crops()) crops[crop.pluginId] = crop;
  const recipes = await getBedRecipes();
  const result = applyBedRecipe(event.params.blockId ?? '', parsed.data, crops, (id) =>
    recipes.get(id)
  );
  if (isFailure(result)) return failureResponse(result);
  return json(result.response, { status: result.status });
};
