import { json, type RequestHandler } from '@sveltejs/kit';
import { listAssignableMembers } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { assignRefusal, canAssignTasks } from '$lib/server/taskAssign';

/**
 * GET /api/tasks/assignees: the people an owner can give a task to (F1-5),
 * `{ assignees: { id, name, role }[] }`. Fetched when the picker opens,
 * never by a page loader. Owners only.
 */
export const GET: RequestHandler = (event) => {
  const auth = currentUser(event);
  if (!auth?.activeOwnerId) return json({ error: 'sign in first' }, { status: 401 });
  if (!canAssignTasks(auth)) return assignRefusal();
  return json({ assignees: listAssignableMembers(auth.activeOwnerId, event.locals?.locale) });
};
