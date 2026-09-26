import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';

/**
 * The Owner this request's session resolves to. The offline queue checks it
 * before replaying rows so a tab whose stored Owner went stale (a switch in
 * another tab) never drains against the wrong farm. `hooks.server.ts` also
 * stamps the same id on the `x-cropcard-owner` response header.
 */
export const GET: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user?.activeOwnerId) {
    return json(
      { error: 'no active owner' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }
  return json({ activeOwnerId: user.activeOwnerId }, { headers: { 'cache-control': 'no-store' } });
};
