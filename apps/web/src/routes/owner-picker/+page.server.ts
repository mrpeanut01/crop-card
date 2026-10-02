import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { writeSession, type SessionRole } from '$lib/server/session';
import { activeAssignmentsForUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { unscopedQueryNote } from '$lib/db/tenant';
import type { PageServerLoad } from './$types';
import { t } from '$lib/i18n';

/**
 * Owner picker — shown to Helpers who belong to multiple Owners. The
 * partial session (`activeOwnerId=null`) routes here from hooks.server.ts;
 * picking an Owner re-mints the cookie with that Owner bound.
 */
export const load: PageServerLoad = ({ locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, '/signin');
  const assignments = activeAssignmentsForUser(user.id);
  if (assignments.length === 0) throw redirect(303, '/onboarding');

  unscopedQueryNote('owner picker spans multiple tenants for one user');
  const ownerRows = db
    .select({ id: owners.id, name: owners.name, slug: owners.slug })
    .from(owners)
    .where(
      inArray(
        owners.id,
        assignments.map((a) => a.ownerId)
      )
    )
    .all();
  const byId = new Map(ownerRows.map((r) => [r.id, r]));
  const choices = assignments
    .map((a) => {
      const o = byId.get(a.ownerId);
      if (!o) return null;
      return { ownerId: o.id, name: o.name, slug: o.slug, roleWithinOwner: a.roleWithinOwner };
    })
    .filter(
      (c): c is { ownerId: string; name: string; slug: string; roleWithinOwner: SessionRole } =>
        c !== null
    );
  return { choices, activeOwnerId: user.activeOwnerId };
};

export const actions: Actions = {
  pick: async (event) => {
    const user = currentUser(event);
    if (!user) throw error(401, t(event.locals.locale, 'settings.err.signIn'));
    const fd = await event.request.formData();
    const ownerId = String(fd.get('ownerId') ?? '');
    if (!ownerId) return fail(400, { error: t(event.locals.locale, 'entry.picker.err.pickFarm') });

    const assignments = activeAssignmentsForUser(user.id);
    const match = assignments.find((a) => a.ownerId === ownerId);
    if (!match) throw error(403, t(event.locals.locale, 'entry.picker.err.notMember'));

    writeSession(event.cookies, {
      id: user.id,
      email: user.email,
      phone: user.phone,
      isSuperadmin: user.isSuperadmin,
      activeOwnerId: ownerId,
      activeRole: match.roleWithinOwner,
      iat: user.sessionIssuedAt
    });
    throw redirect(303, '/today');
  }
};
