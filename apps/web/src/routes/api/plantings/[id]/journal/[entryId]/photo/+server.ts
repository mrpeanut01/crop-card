import { error, type RequestHandler } from '@sveltejs/kit';
import { getJournalPhoto } from '$lib/db/plantingJournal';
import { JPEG_DATA_URL_PREFIX, decodeBase64 } from '$lib/journal/photo';
import { requireUser } from '$lib/server/auth';

/** GET the journal entry's photo as image/jpeg. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const ref = getJournalPhoto(event.params.id ?? '', event.params.entryId ?? '');
  if (!ref || !ref.startsWith(JPEG_DATA_URL_PREFIX)) throw error(404, 'photo not found');
  const bytes = decodeBase64(ref.slice(JPEG_DATA_URL_PREFIX.length));
  if (!bytes) throw error(404, 'photo not found');
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
};
