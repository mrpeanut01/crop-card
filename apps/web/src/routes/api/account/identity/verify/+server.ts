import { json, type RequestHandler } from '@sveltejs/kit';
import { parseIdentifier } from '$lib/identity';
import { refreshSessionIdentity, requireInteractiveUser } from '$lib/server/auth';
import { redeemLinkCode } from '$lib/server/loginCodes';

const ERROR_COPY = {
  invalid: "That code didn't match. Check it and try again.",
  expired: 'That code has expired. Send a new one.',
  'too-many-attempts': 'Too many wrong tries for that code. Send a new one.',
  'in-use': 'That is already the sign-in for a different CropCard account.'
} as const;

/** POST { identifier, code } — confirm the code and attach the identity. */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const body = (await event.request.json().catch(() => null)) as {
    identifier?: unknown;
    code?: unknown;
  } | null;
  const id = parseIdentifier(body?.identifier);
  if (!id) return json({ error: 'Enter an email address or a phone number.' }, { status: 400 });
  const r = redeemLinkCode({ userId: user.id, identifier: id, code: body?.code });
  if (!r.ok) {
    return json({ error: ERROR_COPY[r.error] }, { status: r.error === 'in-use' ? 409 : 400 });
  }
  refreshSessionIdentity(event, user);
  return json({ ok: true, kind: id.kind, identifier: id.value });
};
