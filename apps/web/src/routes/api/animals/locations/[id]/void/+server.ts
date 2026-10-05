import { t } from '$lib/i18n';
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
              ? t(event.locals?.locale, 'api.err.moveChangedGroup')
              : t(event.locals?.locale, 'api.err.latestMoveVoidOnly')
          );
        }
        return result;
      }
    );
  } catch (e) {
    if (e instanceof AnimalRuleError) return e.toResponse();
    return json({ error: t(event.locals?.locale, 'api.err.voidMoveFailed') }, { status: 500 });
  }
};
