/**
 * Phase 25c (#88) — /settings/account loader + actions.
 *
 * The user's identity card: email, role within active Owner, active
 * Owner chip, impersonation banner if relevant. Sprint 2 (#203) adds a
 * functional save action so the form's Save button is no longer
 * permanently disabled. The user-table only persists email today
 * (display name derives from the local-part); time-zone + units-of-
 * measure are accepted but not yet persisted to a real column, kept
 * here as a no-op so the form contract stays stable.
 */

import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { activeAssignmentsForUser } from '$lib/db/users';
import { unscopedQueryNote } from '$lib/db/tenant';
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

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    // Email is the magic-link identity; if the operator typed a new
    // address we'd need an OOB confirmation flow before mutating. For
    // Sprint 2 we accept the field but only persist when it matches the
    // current sign-in identity (no-op) — the alternative is rejecting
    // valid edits silently, which the disabled-button bug already does.
    if (email && email !== locals.user.email) {
      return fail(400, {
        ok: false,
        message:
          'Changing the sign-in email requires confirming the new address via a magic link. Sign out and sign in with the new email to switch identities.'
      });
    }
    unscopedQueryNote('settings/account save touches the global users table (identity)');
    db.update(users).set({ email: locals.user.email }).where(eq(users.id, locals.user.id)).run();
    return { ok: true };
  }
};
