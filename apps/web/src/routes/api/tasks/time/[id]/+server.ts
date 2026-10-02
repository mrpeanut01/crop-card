/**
 * DELETE /api/tasks/time/:id: remove saved task time (D-26). Owners remove
 * any entry; everyone else only their own, for 48 hours after it was saved.
 * Online only, never gated by the season close-out, and a hard delete: time
 * is neither a compliance record nor a hold fact.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { deleteTimeEntry, getTimeEntry } from '$lib/db/taskTime';
import { currentUser } from '$lib/server/auth';
import { timeDeleteVerdict } from '$lib/tasks/timeEntries';

export const DELETE: RequestHandler = (event) => {
  const loc = event.locals.locale;
  const user = currentUser(event);
  if (!user?.activeOwnerId) {
    return json(
      { error: 'UNAUTHENTICATED', message: t(loc, 'tasks.timeApi.signIn') },
      { status: 401 }
    );
  }
  const entry = getTimeEntry(event.params.id ?? '');
  if (!entry)
    return json({ error: 'NOT_FOUND', message: t(loc, 'tasks.timeApi.noEntry') }, { status: 404 });
  const verdict = timeDeleteVerdict(entry, user, Date.now());
  if (verdict === 'READ_ONLY') {
    return json(
      { error: 'READ_ONLY', message: t(loc, 'tasks.timeApi.readOnlyRemove') },
      { status: 403 }
    );
  }
  if (verdict !== 'ok') {
    return json(
      { error: verdict, message: t(loc, 'tasks.timeApi.ownDeleteWindow'), askOwner: true },
      { status: 403 }
    );
  }
  deleteTimeEntry(entry.id);
  return json({ ok: true, id: entry.id });
};
