/**
 * DELETE /api/irrigation/skips/:id: undo a logged waterer skip, so that run
 * counts as water given again (#870, FU870-2). Owners undo any skip; the
 * person who logged it, for 48 hours after it was saved; everyone else is
 * told to ask the owner. Another farm's id reads as missing. Online only,
 * like removing task time: a skip still waiting in the phone's queue has no
 * server id yet, and is removed from /records/pending instead. A hard
 * delete; a skip is neither a compliance record nor a hold fact.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { deleteIrrigationSkip, getIrrigationSkip } from '$lib/db/waterers';
import { skipUndoVerdict } from '$lib/irrigation/skipUndo';
import { currentUser } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  const loc = event.locals?.locale;
  const user = currentUser(event);
  if (!user?.activeOwnerId) {
    return json(
      { error: 'UNAUTHENTICATED', message: t(loc, 'api.err.authRequired') },
      { status: 401 }
    );
  }
  const skip = getIrrigationSkip(event.params.id ?? '');
  if (!skip) {
    return json(
      { error: 'NOT_FOUND', message: t(loc, 'herbsg.api.skipNotFound') },
      { status: 404 }
    );
  }
  const verdict = skipUndoVerdict(skip, { id: user.id, role: user.role }, Date.now());
  if (verdict !== 'ok') {
    return json(
      {
        error: verdict,
        message: t(
          loc,
          verdict === 'READ_ONLY' ? 'herbsg.api.skipUndoReadOnly' : 'herbsg.api.skipUndoAskOwner'
        ),
        askOwner: true
      },
      { status: 403 }
    );
  }
  deleteIrrigationSkip(skip.id);
  return json({ ok: true, id: skip.id });
};
