import { json, type RequestHandler } from '@sveltejs/kit';
import { parseIdentifier } from '$lib/identity';
import { t, type MessageKey } from '$lib/i18n';
import { refreshSessionIdentity, requireInteractiveUser } from '$lib/server/auth';
import { requestLinkCode, unlinkIdentity } from '$lib/server/loginCodes';
import { magicLinkOrigin } from '$lib/server/magicLink';

const LINK_ERROR_KEY = {
  'in-use': 'signin.link.inUse',
  'already-yours': 'signin.link.alreadyYours',
  'rate-limited': 'signin.link.rateLimited'
} as const satisfies Record<string, MessageKey>;

/** POST { identifier } — send a verification code to a new email or phone. */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const locale = event.locals.locale;
  const body = (await event.request.json().catch(() => null)) as { identifier?: unknown } | null;
  const id = parseIdentifier(body?.identifier);
  if (!id) {
    return json({ error: t(locale, 'signin.err.emailOrPhone') }, { status: 400 });
  }
  try {
    let origin: string | null = null;
    try {
      origin = magicLinkOrigin(event.url.origin);
    } catch {
      // No ORIGIN in production: send the code without the autofill line.
    }
    const r = await requestLinkCode({
      userId: user.id,
      identifier: id,
      origin,
      locale: event.locals.locale
    });
    if (!r.ok) {
      return json(
        { error: t(locale, LINK_ERROR_KEY[r.error]) },
        { status: r.error === 'rate-limited' ? 429 : 409 }
      );
    }
    return json({ ok: true, kind: id.kind, identifier: id.value, expiresAt: r.expiresAt });
  } catch (e) {
    console.error('[identity] link code dispatch failed', e instanceof Error ? e.message : e);
    return json(
      {
        error: t(locale, id.kind === 'email' ? 'signin.link.emailFailed' : 'signin.link.textFailed')
      },
      { status: 503 }
    );
  }
};

/** DELETE { kind: 'email' | 'phone' } — remove one; the last one stays. */
export const DELETE: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const body = (await event.request.json().catch(() => null)) as { kind?: unknown } | null;
  if (body?.kind !== 'email' && body?.kind !== 'phone') {
    return json({ error: "kind must be 'email' or 'phone'" }, { status: 400 });
  }
  const r = unlinkIdentity(user.id, body.kind);
  if (!r.ok) {
    return json({ error: t(event.locals.locale, 'signin.link.lastIdentity') }, { status: 409 });
  }
  refreshSessionIdentity(event, user);
  return json({ ok: true });
};
