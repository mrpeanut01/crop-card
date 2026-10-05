import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteJournalEntry } from '$lib/db/plantingJournal';
import { requireOwner } from '$lib/server/auth';
import { cropOr404 } from '$lib/server/journalApi';
import { discardPhoto } from '$lib/server/vault/photoWrite';
import { t } from '$lib/i18n';

/** DELETE /api/plantings/[id]/journal/[entryId]. Owners only. The entry's
 *  photo document is deleted with it. */
export const DELETE: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const crop = cropOr404(event.params.id, event.locals?.locale);
  if (crop instanceof Response) return crop;
  const deleted = deleteJournalEntry(crop.id, event.params.entryId ?? '');
  if (!deleted)
    return json({ error: t(event.locals?.locale, 'api.errB.journalNotFound') }, { status: 404 });
  await discardPhoto(deleted.photoDocumentId, user.id);
  return json({ ok: true });
};
