import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { passkeyAuthenticationSchema } from '$lib/auth/apiSchemas';
import { loginNextPath } from '$lib/server/auth';
import { relyingParty, takeLoginAttempt, verifyLogin } from '$lib/server/passkeys';
import { clientAddressOf } from '$lib/server/passkeyRoutes';

export const _requestSchema = passkeyAuthenticationSchema;

/** POST — check a passkey and sign in. Every failure answers the same
 *  message (P38-12). */
export const POST: RequestHandler = async (event) => {
  const locale = event.locals?.locale;
  const rp = relyingParty(event.url.origin);
  if (!rp) return json({ error: t(locale, 'passkey.err.unavailable') }, { status: 503 });
  if (!takeLoginAttempt(clientAddressOf(event))) {
    return json({ error: t(locale, 'passkey.err.busy') }, { status: 429 });
  }
  const parsed = _requestSchema.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: t(locale, 'passkey.err.signinFailed') }, { status: 400 });
  }
  const outcome = await verifyLogin(event, rp, parsed.data);
  if (!outcome.ok) {
    return json({ error: t(locale, 'passkey.err.signinFailed') }, { status: 401 });
  }
  return json({ next: loginNextPath(outcome.result.next), crossDevice: outcome.crossDevice });
};
