import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { deleteLatestStay, getLocation } from '$lib/db/animalLocations';
import { farmTimeZone } from '$lib/db/userProfile';
import { requireOwner } from '$lib/server/auth';
import { stayExposureRefusal } from '$lib/server/areaGrazing';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

/** Owner only: removes a subject's latest move and reopens the stay before
 *  it. Helpers correct a move by moving the animals back. A move onto an
 *  Area inside a grazing interval stays on record, since it is why the
 *  animals' food is held (C-30). */
export const DELETE: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const stay = getLocation(event.params.id ?? '');
  if (stay) {
    const refusal = await stayExposureRefusal(stay, farmTimeZone());
    if (refusal) return json(refusal, { status: 409 });
  }
  const guarded = await tryGuardedHoldWrite(event, user, () =>
    deleteLatestStay(event.params.id ?? '', user.id)
  );
  if (!guarded.ok) return guarded.response;
  const result = guarded.value;
  if (result.ok) return json({ ok: true, reopened: result.reopened });
  if (result.reason === 'not-found')
    return json({ error: t(event.locals?.locale, 'animallib.api.moveNotFound') }, { status: 404 });
  return json(
    result.reason === 'not-latest'
      ? { error: t(event.locals?.locale, 'api.err.latestMoveOnly'), code: 'NOT_LATEST' }
      : {
          error: t(event.locals?.locale, 'animallib.api.moveChangedGroup'),
          code: 'GROUP_CHANGE'
        },
    { status: 409 }
  );
};
