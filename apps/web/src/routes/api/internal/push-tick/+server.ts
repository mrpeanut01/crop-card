/**
 * POST /api/internal/push-tick — run one push alert tick for every Owner.
 *
 * Called twice a day by the `push-tick` Container Apps Job. Auth is the
 * PUSH_TICK_SECRET shared secret in the x-push-tick-secret header, never a
 * cookie or Bearer token (hooks.server.ts doesn't resolve either for this
 * request). Unset secret or a mismatch answers 404 so the route stays
 * invisible. The tick scopes each Owner through runWithTenantAsync itself.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import {
  TICK_SECRET_HEADER,
  readTickSecret,
  runScheduledTick,
  tickSecretMatches
} from '$lib/server/push/wakeup';

const NO_STORE = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async ({ request }) => {
  const expected = readTickSecret(process.env);
  if (!expected || !tickSecretMatches(request.headers.get(TICK_SECRET_HEADER), expected)) {
    return json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  }
  const result = await runScheduledTick();
  console.log('[push] scheduled tick', JSON.stringify(result));
  return json({ ok: true, ...result }, { headers: NO_STORE });
};
