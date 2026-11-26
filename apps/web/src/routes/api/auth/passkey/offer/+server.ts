import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { clearPasskeyOffer } from '$lib/server/passkeyOffer';

/** DELETE — "Not now" on the add-a-passkey card (P38-7). */
export const DELETE: RequestHandler = (event) => {
  requireUser(event);
  clearPasskeyOffer(event.cookies);
  return json({ ok: true });
};
