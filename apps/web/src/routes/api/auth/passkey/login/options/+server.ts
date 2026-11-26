import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { loginOptions, relyingParty, takeLoginAttempt } from '$lib/server/passkeys';
import { clientAddressOf } from '$lib/server/passkeyRoutes';

/** POST — a sign-in challenge for any passkey on this site (Phase 38). No
 *  credential list, so the browser offers every passkey it holds, or the
 *  phone/QR option (P38-1). Public and rate-limited (P38-12). */
export const POST: RequestHandler = async (event) => {
  const locale = event.locals?.locale;
  const rp = relyingParty(event.url.origin);
  if (!rp) return json({ error: t(locale, 'passkey.err.unavailable') }, { status: 503 });
  if (!takeLoginAttempt(clientAddressOf(event))) {
    return json({ error: t(locale, 'passkey.err.busy') }, { status: 429 });
  }
  return json({ options: await loginOptions(event.cookies, rp) });
};
