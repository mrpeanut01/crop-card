import { error, json, type RequestHandler } from '@sveltejs/kit';
import { activeAssignmentsForUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';

/**
 * Switch the active Owner without a full re-login. Body: `{ ownerId }`.
 * Validates the helper_assignments row, re-mints the session cookie with
 * the new Owner + role. The client is responsible for clearing
 * tenant-namespaced caches (Workbox runtime + Dexie queue) before
 * navigating.
 */
export const POST: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) throw error(401, 'authentication required');

  // Phase 24 — Bearer tokens are owner-scoped at issuance. Allowing an
  // agent to switch owners would let a leaked token roam every tenant
  // its underlying user has access to. Reject; agents must use a token
  // minted under the target Owner.
  if (event.locals.authVia === 'bearer') {
    throw error(403, 'Bearer-authed sessions cannot switch owners');
  }

  const body = await event.request.json().catch(() => null);
  const ownerId = body && typeof body.ownerId === 'string' ? body.ownerId : null;
  if (!ownerId) throw error(400, 'ownerId required');

  const assignments = activeAssignmentsForUser(user.id);
  const match = assignments.find((a) => a.ownerId === ownerId);
  if (!match) throw error(403, 'no active assignment to that Owner');

  writeSession(event.cookies, {
    id: user.id,
    email: user.email,
    isSuperadmin: user.isSuperadmin,
    activeOwnerId: ownerId,
    activeRole: match.roleWithinOwner
  });
  return json({ ok: true, activeOwnerId: ownerId, activeRole: match.roleWithinOwner });
};
