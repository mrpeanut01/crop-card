import type { RequestHandler } from '@sveltejs/kit';
import { getAnimalPhoto } from '$lib/db/animals';
import { requireUser } from '$lib/server/auth';
import { photoResponse } from '$lib/server/vault/photoWrite';

/** GET the animal's photo as image/jpeg, from the vault or, for a row not
 *  moved yet, from its inline data URL. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  return photoResponse(getAnimalPhoto(event.params.id ?? ''));
};
