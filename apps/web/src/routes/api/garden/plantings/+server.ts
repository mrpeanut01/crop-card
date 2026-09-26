import { json, type RequestHandler } from '@sveltejs/kit';
import { plantingCreateSchema, type PlantingCreateResponse } from '$lib/garden/api';
import { requireOwner } from '$lib/server/auth';
import {
  createPlacedPlantings,
  cropLookupFrom,
  failureResponse,
  isFailure
} from '$lib/server/garden/placement';
import { getRegistry } from '$lib/server/registry';

export const _requestSchema = plantingCreateSchema;

/** POST /api/garden/plantings. Creates `planned` plantings straight into
 *  garden beds as one batch. Every item is checked before anything is
 *  written, so a bad item saves nothing. */
export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = plantingCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const result = createPlacedPlantings(parsed.data.plantings, cropLookupFrom(await getRegistry()));
  if (isFailure(result)) return failureResponse(result);
  return json({ plantings: result.plantings } satisfies PlantingCreateResponse, { status: 201 });
};
