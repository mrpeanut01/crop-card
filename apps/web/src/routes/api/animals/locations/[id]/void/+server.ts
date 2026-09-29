import { json, type RequestHandler } from '@sveltejs/kit';
import { getLocation, voidStay } from '$lib/db/animalLocations';
import { holdVoidSchema } from '$lib/animals/holdVoidSchema';
import { AnimalRuleError } from '$lib/server/animals';
import { voidRecord } from '$lib/server/holdVoid';

export const _requestSchema = holdVoidSchema;

/** C-35 §5: the owner voids a move entered by mistake in the last 48
 *  hours. The stay stops counting and the one before it reopens. */
export const POST: RequestHandler = async (event) => {
  const stay = getLocation(event.params.id ?? '', { includeDeleted: true });
  try {
    return await voidRecord(
      event,
      stay ? { kind: 'animal-location', id: stay.id, createdAtMs: stay.createdAt } : null,
      (input) => {
        const result = voidStay(stay!.id, input.reason);
        if (!result.ok) {
          throw new AnimalRuleError(
            result.reason === 'group-change' ? 'GROUP_CHANGE' : 'NOT_LATEST',
            409,
            result.reason === 'group-change'
              ? 'This move changed a group. Move the animal again instead.'
              : 'Only the latest move can be voided.'
          );
        }
        return result;
      }
    );
  } catch (e) {
    if (e instanceof AnimalRuleError) return e.toResponse();
    return json({ error: 'Could not void this move.' }, { status: 500 });
  }
};
