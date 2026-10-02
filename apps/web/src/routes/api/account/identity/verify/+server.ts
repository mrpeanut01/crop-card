import { json, type RequestHandler } from '@sveltejs/kit';
import { parseIdentifier } from '$lib/identity';
import { t, type MessageKey } from '$lib/i18n';
import { refreshSessionIdentity, requireInteractiveUser } from '$lib/server/auth';
import { redeemLinkCode } from '$lib/server/loginCodes';

const ERROR_KEY = {
  invalid: 'signin.code.invalid',
  expired: 'signin.code.expired',
  'too-many-attempts': 'signin.code.tooManyAttempts',
  'in-use': 'signin.link.inUse'
} as const satisfies Record<string, MessageKey>;

/** POST { identifier, code } — confirm the code and attach the identity. */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const locale = event.locals.locale;
  const body = (await event.request.json().catch(() => null)) as {
    identifier?: unknown;
    code?: unknown;
  } | null;
  const id = parseIdentifier(body?.identifier);
  if (!id) return json({ error: t(locale, 'signin.err.emailOrPhone') }, { status: 400 });
  const r = redeemLinkCode({ userId: user.id, identifier: id, code: body?.code });
  if (!r.ok) {
    return json(
      { error: t(locale, ERROR_KEY[r.error]) },
      { status: r.error === 'in-use' ? 409 : 400 }
    );
  }
  refreshSessionIdentity(event, user);
  return json({ ok: true, kind: id.kind, identifier: id.value });
};
