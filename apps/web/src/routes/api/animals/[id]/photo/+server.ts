import { error, type RequestHandler } from '@sveltejs/kit';
import { getAnimalPhoto } from '$lib/db/animals';
import { JPEG_DATA_URL_PREFIX, decodeBase64 } from '$lib/journal/photo';
import { requireUser } from '$lib/server/auth';

/** GET the animal's photo as image/jpeg. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const ref = getAnimalPhoto(event.params.id ?? '');
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
