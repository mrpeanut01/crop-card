import { json, type RequestHandler } from '@sveltejs/kit';
import { requireInteractiveUser } from '$lib/server/auth';
import { listPasskeys } from '$lib/server/passkeys';

/** GET — the signed-in person's passkeys (no key material). */
export const GET: RequestHandler = (event) => {
  const user = requireInteractiveUser(event);
  return json({ passkeys: listPasskeys(user.id) });
};
