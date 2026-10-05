import { t } from '$lib/i18n';
/**
 * DELETE /api/auth/token/[id] — revoke a Bearer token.
 *
 * Owner-only. Composite (owner_id, id) gate inside revokeToken() so an
 * Owner can't revoke another Owner's token even if they guess the id.
 *
 * Phase 24 / UC-43.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { revokeToken } from '$lib/server/apiTokens';

export const DELETE: RequestHandler = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, t(event.locals?.locale, 'api.err.noActiveOwner'));
  const tokenId = event.params.id;
  if (!tokenId) throw error(400, t(event.locals?.locale, 'api.err.tokenIdRequired'));
  const ok = revokeToken(u.activeOwnerId, tokenId);
  if (!ok) throw error(404, t(event.locals?.locale, 'api.err.tokenNotFound'));
  return json({ ok: true });
};
