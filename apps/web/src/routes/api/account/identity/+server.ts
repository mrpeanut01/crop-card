import { json, type RequestHandler } from '@sveltejs/kit';
import { parseIdentifier } from '$lib/identity';
import { refreshSessionIdentity, requireInteractiveUser } from '$lib/server/auth';
import { requestLinkCode, unlinkIdentity } from '$lib/server/loginCodes';

const LINK_ERROR_COPY = {
  'in-use': 'That is already the sign-in for a different CropCard account.',
  'already-yours': 'That is already on your account.',
  'rate-limited': 'Too many codes requested. Wait a few minutes and try again.'
} as const;

/** POST { identifier } — send a verification code to a new email or phone. */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const body = (await event.request.json().catch(() => null)) as { identifier?: unknown } | null;
  const id = parseIdentifier(body?.identifier);
  if (!id) {
    return json({ error: 'Enter an email address or a phone number.' }, { status: 400 });
  }
  try {
    const r = await requestLinkCode({ userId: user.id, identifier: id });
    if (!r.ok) {
      return json(
        { error: LINK_ERROR_COPY[r.error] },
        { status: r.error === 'rate-limited' ? 429 : 409 }
      );
    }
    return json({ ok: true, kind: id.kind, identifier: id.value, expiresAt: r.expiresAt });
  } catch (e) {
    console.error('[identity] link code dispatch failed', e instanceof Error ? e.message : e);
    return json(
      { error: `We couldn't send the ${id.kind === 'email' ? 'email' : 'text'} just now.` },
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
    return json(
      { error: "You can't remove your only way to sign in. Add the other one first." },
      { status: 409 }
    );
  }
  refreshSessionIdentity(event, user);
  return json({ ok: true });
};
