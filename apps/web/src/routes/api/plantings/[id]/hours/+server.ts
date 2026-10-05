import { json, type RequestHandler } from '@sveltejs/kit';
import { getCrop } from '$lib/db/crops';
import { listTimeEntriesForCrop } from '$lib/db/taskTime';
import { memberNamesByIds } from '$lib/db/users';
import { sumMinutes, totalMinutes } from '$lib/labour/hours';
import { currentUser } from '$lib/server/auth';
import { t } from '$lib/i18n';

/**
 * GET /api/plantings/:id/hours: time logged on this planting's tasks, in
 * total and per person (F1-17). Owners only; everyone else sees the total
 * on the Planting Card from the offline snapshot.
 */
export const GET: RequestHandler = (event) => {
  const auth = currentUser(event);
  if (!auth?.activeOwnerId)
    return json({ error: t(event.locals?.locale, 'api.errB.signInFirst') }, { status: 401 });
  if (auth.role !== 'owner')
    return json({ error: t(event.locals?.locale, 'api.errB.ownerRoleRequired') }, { status: 403 });
  const id = event.params.id ?? '';
  if (!getCrop(id))
    return json({ error: t(event.locals?.locale, 'api.errB.plantingNotFound') }, { status: 404 });
  const rows = listTimeEntriesForCrop(id);
  const perUser = sumMinutes(rows, 'user');
  const names = memberNamesByIds([...perUser.keys()], event.locals?.locale);
  const byPerson = [...perUser]
    .map(([userId, minutes]) => ({
      id: userId,
      name: names.get(userId) ?? t(event.locals?.locale, 'tasks.timeApi.formerMember'),
      minutes
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  return json({ totalMinutes: totalMinutes(rows), byPerson });
};
