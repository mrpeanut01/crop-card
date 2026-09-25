import { json, type RequestHandler } from '@sveltejs/kit';
import { handleMagicLinkRequest } from '$lib/server/magicLink';

/**
 * POST /api/auth/magic-link { email, invite? } — anonymous. Every
 * well-formed request gets the same 200 body whether or not the account
 * exists or the request was throttled (no enumeration). Available in both
 * AUTH_MODEs; only the direct email login is mode-gated.
 */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => null)) as {
    email?: unknown;
    invite?: unknown;
  } | null;
  const result = await handleMagicLinkRequest(event, body?.email, body?.invite);
  const headers = { 'cache-control': 'no-store' };
  if (!result.ok) return json({ error: result.error }, { status: result.status, headers });
  return json({ ok: true, message: result.message }, { headers });
};
