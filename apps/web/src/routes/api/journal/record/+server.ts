import { type RequestHandler } from '@sveltejs/kit';
import { withClientRecordId } from '$lib/server/clientRecordId';
import {
  addJournalEntry,
  badRequest,
  journalWriter,
  queuedJournalSchema,
  readJson
} from '$lib/server/journalApi';

export const _requestSchema = queuedJournalSchema;

/** POST /api/journal/record. The offline queue's replay endpoint for
 *  journal notes and photos; the planting id travels in the body. */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const who = await journalWriter(event);
  if (!who.ok) return who.response;
  const parsed = queuedJournalSchema.safeParse(await readJson(event));
  if (!parsed.success) return badRequest(parsed.error);
  const { cropId, ...entry } = parsed.data;
  return addJournalEntry(event, cropId, who.userId, entry);
});
