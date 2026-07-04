import { error, redirect, type Actions } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';
import { addAssignment } from '$lib/db/users';
import { diagnoseInvite, findRedeemableInvite, markInviteAccepted } from '$lib/server/invites';
import { unscopedQueryNote } from '$lib/db/tenant';
import type { PageServerLoad } from './$types';

/**
 * Redeem an invite. Two cases:
 *   - User is not signed in → bounce to /signin?invite=<token> so they
 *     authenticate first; the token round-trips back here.
 *   - User is signed in → look up the invite by (token, signed-in email);
 *     if it matches and is still pending, insert/upgrade the assignment
 *     and re-mint the session bound to the new Owner.
 */
export const load: PageServerLoad = async (event) => {
  const token = event.params.token;
  if (!token) throw error(400, 'missing token');
  const user = currentUser(event);
  if (!user) {
    throw redirect(303, `/?invite=${encodeURIComponent(token)}`);
  }

  const match = findRedeemableInvite(token, user.email);
  if (!match) {
    return { token, status: 'invalid' as const, reason: diagnoseInvite(token, user.email) };
  }

  unscopedQueryNote('owner name for the redemption confirmation screen');
  const ownerRow = db
    .select({ name: owners.name })
    .from(owners)
    .where(eq(owners.id, match.ownerId))
    .get();
  return {
    token,
    status: 'ready' as const,
    ownerId: match.ownerId,
    ownerName: ownerRow?.name ?? 'a CropCard farm',
    roleWithinOwner: match.roleWithinOwner,
    expiresAt: match.expiresAt
  };
};

export const actions: Actions = {
  accept: async (event) => {
    const token = event.params.token;
    if (!token) throw error(400, 'missing token');
    const user = currentUser(event);
    if (!user) throw redirect(303, `/?invite=${encodeURIComponent(token)}`);

    const match = findRedeemableInvite(token, user.email);
    if (!match) throw error(400, 'invite is no longer valid');

    addAssignment({
      ownerId: match.ownerId,
      userId: user.id,
      roleWithinOwner: match.roleWithinOwner
    });
    markInviteAccepted(match.id);

    // Re-mint the session with the new Owner active so the helper lands in
    // the right tenant immediately. If they already had an active Owner,
    // they can switch back via the picker.
    writeSession(event.cookies, {
      id: user.id,
      email: user.email,
      isSuperadmin: user.isSuperadmin,
      activeOwnerId: match.ownerId,
      activeRole: match.roleWithinOwner
    });
    throw redirect(303, '/today');
  }
};
