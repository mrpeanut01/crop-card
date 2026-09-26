import { json, type RequestHandler } from '@sveltejs/kit';
import { applyUnsubscribe } from '$lib/server/emailPrefs';
import { verifyUnsubscribeToken } from '$lib/server/emailUnsubscribe';

async function oneClickValue(request: Request): Promise<string | null> {
  if (/multipart\/form-data/i.test(request.headers.get('content-type') ?? '')) {
    const fd = await request.formData().catch(() => null);
    const v = fd?.get('List-Unsubscribe');
    return typeof v === 'string' ? v : null;
  }
  const raw = await request.text().catch(() => '');
  return new URLSearchParams(raw).get('List-Unsubscribe');
}

/**
 * RFC 8058 one-click unsubscribe, the target of every opt-in email's
 * List-Unsubscribe header. The mail client POSTs `List-Unsubscribe=One-Click`
 * with no cookies; the signed token in `?t=` is the only authority, and it
 * can only turn its own user's alert email off. Idempotent. GET does
 * nothing here, so a link scanner can't unsubscribe anyone; people who click
 * through land on /unsubscribe/<token> instead.
 */
export const POST: RequestHandler = async ({ url, request }) => {
  const claims = verifyUnsubscribeToken(url.searchParams.get('t'));
  if (!claims) return json({ error: 'invalid unsubscribe link' }, { status: 400 });
  if ((await oneClickValue(request)) !== 'One-Click') {
    return json({ error: 'expected List-Unsubscribe=One-Click' }, { status: 400 });
  }
  const turnedOff = applyUnsubscribe(claims, 'one-click');
  return json({ ok: true, turnedOff });
};

export const GET: RequestHandler = ({ url }) => {
  const t = url.searchParams.get('t');
  const target = t ? `/unsubscribe/${encodeURIComponent(t)}` : '/';
  return new Response(null, { status: 303, headers: { location: target } });
};
