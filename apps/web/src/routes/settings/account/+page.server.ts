/**
 * Phase 25c (#88) — /settings/account loader + actions.
 *
 * The user's identity card: email, role within active Owner, active
 * Owner chip, impersonation banner if relevant. The save action persists
 * the display name; time-zone + units-of-measure are accepted but not yet
 * persisted to a real column. The profile picture uploads on its own
 * through /api/account/avatar.
 */

import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { activeAssignmentsForUser } from '$lib/db/users';
import { avatarUrl, avatarVersion, setDisplayName } from '$lib/db/userProfile';
import { normalizeDisplayName } from '$lib/profile';
import { identityName } from '$lib/identity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const user = locals.user;

  const userRow = db.select().from(users).where(eq(users.id, user.id)).get();
  const activeOwner = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  const assignments = activeAssignmentsForUser(user.id);

  const memberSince = userRow?.createdAt
    ? userRow.createdAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';
  const lastLogin = `today · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  return {
    account: {
      id: user.id,
      email: userRow ? userRow.email : user.email,
      phone: userRow ? userRow.phone : user.phone,
      name: identityName(userRow ?? user),
      displayName: userRow?.displayName ?? '',
      avatarUrl: avatarUrl(user.id, avatarVersion(user.id)),
      role: user.role,
      isSuperadmin: user.isSuperadmin === true,
      impersonating: user.impersonating === true,
      since: memberSince,
      lastLogin
    },
    activeOwner: activeOwner
      ? { id: activeOwner.id, name: activeOwner.name, slug: activeOwner.slug }
      : null,
    otherOwnerCount: Math.max(0, assignments.length - (user.activeOwnerId ? 1 : 0))
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    if (locals.user.impersonating) {
      return fail(403, {
        error: "You can't change someone's profile while impersonating them.",
        name: undefined
      });
    }
    // Sign-in email/phone change only through the verified-code flow in
    // the "Sign-in methods" section (/api/account/identity).
    const fd = await request.formData();
    const name = normalizeDisplayName(fd.get('name'));
    if (!name.ok) return fail(400, { error: name.error, name: String(fd.get('name') ?? '') });
    setDisplayName(locals.user.id, name.value);
    return { ok: true };
  }
};
