import { error, json, type RequestHandler } from '@sveltejs/kit';
import { activeAssignmentsForUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';
import { t } from '$lib/i18n';

/**
 * Switch the active Owner without a full re-login. Body: `{ ownerId }`.
 * Validates the helper_assignments row, re-mints the session cookie with
 * the new Owner + role. The client is responsible for clearing
 * tenant-namespaced caches (Workbox runtime + Dexie queue) before
 * navigating.
 */
export const POST: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) throw error(401, t(event.locals?.locale, 'api.errB.authRequired'));

  // Phase 24 — Bearer tokens are owner-scoped at issuance. Allowing an
  // agent to switch owners would let a leaked token roam every tenant
  // its underlying user has access to. Reject; agents must use a token
  // minted under the target Owner.
  if (event.locals.authVia === 'bearer') {
    throw error(403, t(event.locals?.locale, 'api.errB.bearerSwitch'));
  }

  const body = await event.request.json().catch(() => null);
  const ownerId = body && typeof body.ownerId === 'string' ? body.ownerId : null;
  if (!ownerId) throw error(400, t(event.locals?.locale, 'api.errB.ownerIdRequired'));

  const assignments = activeAssignmentsForUser(user.id);
  const match = assignments.find((a) => a.ownerId === ownerId);
  if (!match) throw error(403, t(event.locals?.locale, 'api.errB.noAssignment'));

  writeSession(event.cookies, {
    id: user.id,
    email: user.email,
    phone: user.phone,
    isSuperadmin: user.isSuperadmin,
    activeOwnerId: ownerId,
    activeRole: match.roleWithinOwner,
    iat: user.sessionIssuedAt
  });
  return json({ ok: true, activeOwnerId: ownerId, activeRole: match.roleWithinOwner });
};
