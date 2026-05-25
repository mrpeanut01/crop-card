/**
 * Phase 25c (#88) — /settings/account loader.
 *
 * The user's identity card: email, role within active Owner, active
 * Owner chip, impersonation banner if relevant. Most identity flow
 * (sign-in, magic link, etc.) is at /+page.server.ts; this page is
 * the surface where the operator confirms which account is active
 * and (eventually) signs out / switches owners.
 */

import { error, type ServerLoad } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { activeAssignmentsForUser } from '$lib/db/users';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const user = locals.user;

  const activeOwner = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  // Assignments cross-tenant so the operator can see which other
  // Owners they have access to (Phase 18c owner-picker context).
  const assignments = activeAssignmentsForUser(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      isSuperadmin: user.isSuperadmin === true,
      impersonating: user.impersonating === true
    },
    activeOwner: activeOwner
      ? { id: activeOwner.id, name: activeOwner.name, slug: activeOwner.slug }
      : null,
    otherOwnerCount: Math.max(0, assignments.length - (user.activeOwnerId ? 1 : 0))
  };
};
