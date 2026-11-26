import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { requireInteractiveUser } from '$lib/server/auth';
import { addRefusal, registrationOptions, relyingParty } from '$lib/server/passkeys';
import { refusalResponse } from '$lib/server/passkeyRoutes';

/** POST — a registration challenge for the signed-in person (Phase 38).
 *  Cookie session only, within 10 minutes of signing in (P38-5), never on
 *  a demo farm (P38-8). */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const locale = event.locals?.locale;
  const refusal = addRefusal(user);
  if (refusal) return refusalResponse(refusal, locale);
  const rp = relyingParty(event.url.origin);
  if (!rp) return json({ error: t(locale, 'passkey.err.unavailable') }, { status: 503 });
  return json({ options: await registrationOptions(event.cookies, rp, user) });
};
