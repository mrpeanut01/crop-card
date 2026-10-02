/**
 * DELETE /api/tasks/time/:id: remove saved task time (D-26). Owners remove
 * any entry; everyone else only their own, for 48 hours after it was saved.
 * Online only, never gated by the season close-out, and a hard delete: time
 * is neither a compliance record nor a hold fact.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteTimeEntry, getTimeEntry } from '$lib/db/taskTime';
import { currentUser } from '$lib/server/auth';
import { OWN_TIME_DELETE_TEXT, timeDeleteVerdict } from '$lib/tasks/timeEntries';

export const DELETE: RequestHandler = (event) => {
  const user = currentUser(event);
  if (!user?.activeOwnerId) {
    return json({ error: 'UNAUTHENTICATED', message: 'Sign in first.' }, { status: 401 });
  }
  const entry = getTimeEntry(event.params.id ?? '');
  if (!entry) return json({ error: 'NOT_FOUND', message: 'No such time entry.' }, { status: 404 });
  const verdict = timeDeleteVerdict(entry, user, Date.now());
  if (verdict === 'READ_ONLY') {
    return json(
      { error: 'READ_ONLY', message: 'Inspectors can read time but not remove it.' },
      { status: 403 }
    );
  }
  if (verdict !== 'ok') {
    return json({ error: verdict, message: OWN_TIME_DELETE_TEXT, askOwner: true }, { status: 403 });
  }
  deleteTimeEntry(entry.id);
  return json({ ok: true, id: entry.id });
};
