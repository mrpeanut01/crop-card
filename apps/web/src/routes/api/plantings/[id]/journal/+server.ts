import { json, type RequestHandler } from '@sveltejs/kit';
import { listJournalForCrop } from '$lib/db/plantingJournal';
import { requireUser } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import {
  addJournalEntry,
  badRequest,
  cropOr404,
  journalEntrySchema,
  journalWriter,
  readJson
} from '$lib/server/journalApi';

export const _requestSchema = journalEntrySchema;

/** GET /api/plantings/[id]/journal. Newest first; photos load separately. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const crop = cropOr404(event.params.id);
  if (crop instanceof Response) return crop;
  return json({ entries: listJournalForCrop(crop.id) });
};

/** POST /api/plantings/[id]/journal. A note, observation or photo from an
 *  owner or helper, saved as `manual`. */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const who = await journalWriter(event);
  if (!who.ok) return who.response;
  const parsed = journalEntrySchema.safeParse(await readJson(event));
  if (!parsed.success) return badRequest(parsed.error);
  return addJournalEntry(event.params.id ?? '', who.userId, parsed.data);
});
