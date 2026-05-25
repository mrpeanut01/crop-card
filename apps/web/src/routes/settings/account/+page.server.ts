/**
 * Phase 25c (#88) — /settings/account loader.
 *
 * The user's identity card: email, role within active Owner, active
 * Owner chip, impersonation banner if relevant. Most identity flow
 * (sign-in, magic link, etc.) is at /+page.server.ts; this page is
 * the surface where the operator confirms which account is active
 * and (eventually) signs out / switches owners.
 */

import { error } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { activeAssignmentsForUser } from '$lib/db/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const user = locals.user;

  const userRow = db.select().from(users).where(eq(users.id, user.id)).get();
  const activeOwner = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  // Assignments cross-tenant so the operator can see which other
  // Owners they have access to (Phase 18c owner-picker context).
  const assignments = activeAssignmentsForUser(user.id);

  const memberSince = userRow?.createdAt
    ? userRow.createdAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';
  const lastLogin = `today · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  return {
    // Account-specific projection. Distinct key from layout's `user`
    // (which carries activeOwnerId etc.) to avoid the cross-loader
    // type collision.
    account: {
      id: user.id,
      email: user.email,
      name: user.email.split('@')[0],
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
