import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { dispatchEmail } from '$lib/server/email';
import { issueInvite, listInvitesForOwner, revokeInvite } from '$lib/server/invites';
import { usersForOwner, revokeAssignment } from '$lib/db/users';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');

  const assignments = usersForOwner(u.activeOwnerId);
  unscopedQueryNote('hydrate user emails for the active Owner\'s assignment list');
  const userRows = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, assignments.map((a) => a.userId)))
    .all();
  const byId = new Map(userRows.map((r) => [r.id, r.email]));

  return {
    members: assignments.map((a) => ({
      userId: a.userId,
      email: byId.get(a.userId) ?? '(unknown)',
      roleWithinOwner: a.roleWithinOwner,
      status: a.status
    })),
    invites: listInvitesForOwner(u.activeOwnerId)
  };
};

export const actions: Actions = {
  invite: async (event) => {
    const u = requireOwner(event);
    if (!u.activeOwnerId) throw error(400, 'no active owner');
    const fd = await event.request.formData();
    const inviteeEmail = String(fd.get('email') ?? '').trim();
    const role = String(fd.get('role') ?? 'helper');
    if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
      return fail(400, { error: 'invalid email' });
    }
    if (!['helper', 'inspector', 'custom-operator'].includes(role)) {
      return fail(400, { error: 'invalid role' });
    }
    const issued = issueInvite({
      ownerId: u.activeOwnerId,
      inviteeEmail,
      roleWithinOwner: role as 'helper' | 'inspector' | 'custom-operator',
      invitedByUserId: u.id
    });

    unscopedQueryNote('owner name for the invite email subject');
    const ownerRow = db
      .select({ name: owners.name })
      .from(owners)
      .where(eq(owners.id, u.activeOwnerId))
      .get();
    const acceptUrl = `${event.url.origin}/invite/${issued.token}`;
    await dispatchEmail({
      kind: 'helper-invite',
      to: inviteeEmail,
      ownerName: ownerRow?.name ?? 'a CropCard farm',
      acceptUrl,
      expiresAt: issued.expiresAt
    });
    return { ok: true, acceptUrl };
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
