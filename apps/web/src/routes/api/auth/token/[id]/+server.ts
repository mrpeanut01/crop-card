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
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  const tokenId = event.params.id;
  if (!tokenId) throw error(400, 'tokenId required');
  const ok = revokeToken(u.activeOwnerId, tokenId);
  if (!ok) throw error(404, 'token not found');
  return json({ ok: true });
};
