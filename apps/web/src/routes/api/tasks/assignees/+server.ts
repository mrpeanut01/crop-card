import { json, type RequestHandler } from '@sveltejs/kit';
import { listAssignableMembers } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { assignRefusal, canAssignTasks } from '$lib/server/taskAssign';
import { t } from '$lib/i18n';

/**
 * GET /api/tasks/assignees: the people an owner can give a task to (F1-5),
 * `{ assignees: { id, name, role }[] }`. Fetched when the picker opens,
 * never by a page loader. Owners only.
 */
export const GET: RequestHandler = (event) => {
  const auth = currentUser(event);
  if (!auth?.activeOwnerId)
    return json({ error: t(event.locals?.locale, 'api.errB.signInFirst') }, { status: 401 });
  if (!canAssignTasks(auth)) return assignRefusal(event.locals?.locale);
  return json({ assignees: listAssignableMembers(auth.activeOwnerId, event.locals?.locale) });
};
