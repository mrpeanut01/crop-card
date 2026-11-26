import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { passkeyRegistrationSchema } from '$lib/auth/apiSchemas';
import { requireInteractiveUser } from '$lib/server/auth';
import { addRefusal, relyingParty, verifyRegistration } from '$lib/server/passkeys';
import { refusalResponse } from '$lib/server/passkeyRoutes';

export const _requestSchema = passkeyRegistrationSchema;

/** POST — store the new passkey after the device made it. */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const locale = event.locals?.locale;
  const refusal = addRefusal(user);
  if (refusal) return refusalResponse(refusal, locale);
  const rp = relyingParty(event.url.origin);
  if (!rp) return json({ error: t(locale, 'passkey.err.unavailable') }, { status: 503 });
  const parsed = _requestSchema.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: t(locale, 'passkey.err.addFailed') }, { status: 400 });
  }
  const r = await verifyRegistration(event.cookies, rp, user, parsed.data);
  if (!r.ok) {
    return json(
      {
        error: t(
          locale,
          r.reason === 'duplicate' ? 'passkey.err.duplicate' : 'passkey.err.addFailed'
        )
      },
      { status: r.reason === 'duplicate' ? 409 : 400 }
    );
  }
  return json({ ok: true, id: r.id }, { status: 201 });
};
