import type { RequestHandler } from '@sveltejs/kit';
import { getJournalPhoto } from '$lib/db/plantingJournal';
import { requireUser } from '$lib/server/auth';
import { photoResponse } from '$lib/server/vault/photoWrite';

/** GET the journal entry's photo as image/jpeg, from the vault or, for a
 *  row not moved yet, from its inline data URL. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  return photoResponse(getJournalPhoto(event.params.id ?? '', event.params.entryId ?? ''));
};
