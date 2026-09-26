import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { dispatchEmail } from '$lib/server/email';
import { issueInvite, listInvitesForOwner, revokeInvite } from '$lib/server/invites';
import { seatUsage, SEAT_LIMIT_MESSAGE } from '$lib/server/billing/plans';
import { usersForOwner, revokeAssignment } from '$lib/db/users';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';
import { avatarUrl, avatarVersions } from '$lib/db/userProfile';
import { identityLabel, identityName } from '$lib/identity';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');

  const assignments = usersForOwner(u.activeOwnerId);
  unscopedQueryNote("hydrate user emails for the active Owner's assignment list");
  const userRows = db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      displayName: users.displayName
    })
    .from(users)
    .where(
      inArray(
        users.id,
        assignments.map((a) => a.userId)
      )
    )
    .all();
  const byId = new Map(userRows.map((r) => [r.id, r]));
  const avatars = avatarVersions(userRows.map((r) => r.id));

  return {
    members: assignments.map((a) => {
      const r = byId.get(a.userId);
      return {
        userId: a.userId,
        email: r ? identityLabel(r) : '(unknown)',
        name: r ? identityName(r) : '(unknown)',
        avatarUrl: avatarUrl(a.userId, avatars.get(a.userId)),
        roleWithinOwner: a.roleWithinOwner,
        status: a.status
      };
    }),
    invites: listInvitesForOwner(u.activeOwnerId),
    seats: seatUsage(u.activeOwnerId)
  };
};

export const actions: Actions = {
  invite: async (event) => {
    const u = requireOwner(event);
    if (!u.activeOwnerId) throw error(400, 'no active owner');
    const fd = await event.request.formData();
    const inviteeEmail = String(fd.get('email') ?? '').trim();
    if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
      return fail(400, { error: 'invalid email' });
    }
    const seats = seatUsage(u.activeOwnerId);
    if (!seats.canInvite) {
      return fail(409, { error: SEAT_LIMIT_MESSAGE, seatLimit: true });
    }
    const issued = issueInvite({
      ownerId: u.activeOwnerId,
      inviteeEmail,
      roleWithinOwner: 'helper',
      invitedByUserId: u.id
    });

    unscopedQueryNote('owner name for the invite email subject');
    const ownerRow = db
      .select({ name: owners.name })
      .from(owners)
      .where(eq(owners.id, u.activeOwnerId))
      .get();
    const acceptUrl = `${event.url.origin}/invite/${issued.token}`;
    const emailSent = await dispatchEmail({
      kind: 'helper-invite',
      to: inviteeEmail,
      ownerName: ownerRow?.name ?? 'a CropCard farm',
      acceptUrl,
      expiresAt: issued.expiresAt
    }).then(
      () => true,
      (err) => {
        console.error('[invites] email dispatch failed; invite link still valid', err);
        return false;
      }
    );
    return { ok: true, acceptUrl, emailSent };
  },
  revoke: async (event) => {
    const u = requireOwner(event);
    if (!u.activeOwnerId) throw error(400, 'no active owner');
    const fd = await event.request.formData();
    const inviteId = String(fd.get('inviteId') ?? '');
    if (!inviteId) return fail(400, { error: 'inviteId required' });
    revokeInvite(u.activeOwnerId, inviteId);
    return { ok: true };
  },
  remove: async (event) => {
    const u = requireOwner(event);
    if (!u.activeOwnerId) throw error(400, 'no active owner');
    const fd = await event.request.formData();
    const userId = String(fd.get('userId') ?? '');
    if (!userId) return fail(400, { error: 'userId required' });
    if (userId === u.id) return fail(400, { error: 'cannot remove yourself' });
    revokeAssignment(u.activeOwnerId, userId);
    return { ok: true };
  }
};
