/**
 * Phase 25c (#88) — /settings/account loader + actions.
 *
 * The user's identity card: email, role within active Owner, active
 * Owner chip, impersonation banner if relevant. The save action persists
 * display name, time zone and display units; the profile picture uploads
 * on its own through /api/account/avatar.
 */

import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { activeAssignmentsForUser } from '$lib/db/users';
import { avatarUrl, avatarVersion, updateProfile } from '$lib/db/userProfile';
import {
  DEFAULT_TIME_ZONE,
  normalizeDisplayName,
  normalizeDisplayUnits,
  normalizeTimeZone
} from '$lib/profile';
import { identityName } from '$lib/identity';
import { formatInstant } from '$lib/prefs';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const user = locals.user;

  const userRow = db.select().from(users).where(eq(users.id, user.id)).get();
  const activeOwner = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  const assignments = activeAssignmentsForUser(user.id);

  const timeZone = userRow?.timeZone ?? DEFAULT_TIME_ZONE;
  const displayUnits = userRow?.displayUnits ?? 'us';
  const prefs = { timeZone, units: displayUnits };
  const memberSince = userRow?.createdAt
    ? formatInstant(userRow.createdAt, prefs, 'date', { day: undefined })
    : '—';
  const lastLogin = `today · ${formatInstant(new Date(), prefs, 'time', { timeZoneName: 'short' })}`;

  return {
    account: {
      id: user.id,
      email: userRow ? userRow.email : user.email,
      phone: userRow ? userRow.phone : user.phone,
      name: identityName(userRow ?? user),
      displayName: userRow?.displayName ?? '',
      timeZone,
      displayUnits,
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
    if (locals.user.impersonating) throw error(403, 'not available while impersonating');
    // Sign-in email/phone change only through the verified-code flow in
    // the "Sign-in methods" section (/api/account/identity).
    const fd = await request.formData();
    const submitted = {
      name: String(fd.get('name') ?? ''),
      timeZone: String(fd.get('timeZone') ?? ''),
      displayUnits: String(fd.get('displayUnits') ?? '')
    };
    const name = normalizeDisplayName(fd.get('name'));
    const timeZone = normalizeTimeZone(fd.get('timeZone'));
    const displayUnits = normalizeDisplayUnits(fd.get('displayUnits'));
    if (!name.ok) return fail(400, { error: name.error, submitted });
    if (!timeZone.ok) return fail(400, { error: timeZone.error, submitted });
    if (!displayUnits.ok) return fail(400, { error: displayUnits.error, submitted });
    updateProfile(locals.user.id, {
      displayName: name.value,
      timeZone: timeZone.value,
      displayUnits: displayUnits.value
    });
    return { ok: true };
  }
};
