import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteJournalEntry } from '$lib/db/plantingJournal';
import { requireOwner } from '$lib/server/auth';
import { cropOr404 } from '$lib/server/journalApi';

/** DELETE /api/plantings/[id]/journal/[entryId]. Owners only. */
export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const crop = cropOr404(event.params.id);
  if (crop instanceof Response) return crop;
  if (!deleteJournalEntry(crop.id, event.params.entryId ?? '')) {
    return json({ error: 'journal entry not found' }, { status: 404 });
  }
  return json({ ok: true });
};
