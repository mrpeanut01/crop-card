import { fail, redirect, type Actions } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { fields, helperAssignments, ownerSubscriptions, owners } from '$lib/db/schema';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  // #108 / CT-OB-001 — guard against silent second-farm creation. The
  // hooks layer allows partial sessions through to /onboarding so users
  // mid-bootstrap can finish setup; the symmetric block for *full*
  // sessions wasn't there, so a logged-in onboarded user typing the URL
  // could submit and silently get a second `owners` row. Bouncing here
  // is the belt half of belt-and-braces; the POST action below is the
  // braces.
  if (locals.user?.activeOwnerId) {
    throw redirect(303, '/today');
  }
  return { user: locals.user ?? null };
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function uniqueSlug(base: string): string {
  unscopedQueryNote('slug uniqueness check spans all owners (the slug column is globally unique)');
  let candidate = base || 'farm';
  for (let i = 0; i < 50; i++) {
    const suffix = i === 0 ? '' : `-${i}`;
    const trial = `${candidate}${suffix}`;
    const exists = db.select({ id: owners.id }).from(owners).where(eq(owners.slug, trial)).get();
    if (!exists) return trial;
  }
  // Fallback: random tail.
  return `${candidate}-${randomUUID().slice(0, 6)}`;
}

export const actions: Actions = {
  default: async (event) => {
    const user = currentUser(event);
    if (!user) throw redirect(303, '/signin');

    // #108 / CT-OB-001 — defence-in-depth POST guard. Catches the case
    // where the page was loaded with a partial session, the user then
    // completed onboarding in a different tab, and finally submitted
    // this form. Without this check the second submission would silently
    // create a duplicate `owners` row and switch `activeOwnerId`.
    if (user.activeOwnerId) {
      return fail(400, {
        error:
          'Your farm is already set up. Visit Settings to rename it, or open the Setup guide from /setup.'
      });
    }

    const fd = await event.request.formData();
    const farmName = String(fd.get('farmName') ?? '').trim();
    const location = String(fd.get('location') ?? '').trim();
    if (!farmName) return fail(400, { error: 'farmName required' });

    const ownerId = `owner_${randomUUID().slice(0, 12)}`;
    const slug = uniqueSlug(slugify(farmName));
    const now = new Date(Date.now());

    db.transaction(() => {
      unscopedQueryNote('onboarding writes the new owner + assignment + subscription rows');
      db.insert(owners)
        .values({
          id: ownerId,
          name: farmName,
          slug,
          billingStatus: 'trial',
          pluginOverridesRevision: 0,
          createdAt: now
        })
        .run();
      db.insert(helperAssignments)
        .values({
          ownerId,
          userId: user.id,
          roleWithinOwner: 'owner',
          acceptedAt: now,
          status: 'active',
          createdAt: now
        })
        .onConflictDoUpdate({
          target: [helperAssignments.ownerId, helperAssignments.userId],
          set: { roleWithinOwner: 'owner', status: 'active', acceptedAt: now }
        })
        .run();
      db.insert(ownerSubscriptions)
        .values({
          ownerId,
          planCode: 'free',
          status: 'trial',
          createdAt: now,
          updatedAt: now
        })
        .run();
    });

    // Seed the Home Field for the new tenant so block creation has a default
    // parent. Wrapped in `runWithTenant` because the fields repo is scoped.
    runWithTenant(ownerId, () => {
      db.insert(fields)
        .values({
          id: randomUUID(),
          ownerId,
          name: 'Home Field',
          location: location || null,
          createdAt: now
        })
        .run();
    });

    writeSession(event.cookies, {
      id: user.id,
      email: user.email,
      isSuperadmin: user.isSuperadmin,
      activeOwnerId: ownerId,
      activeRole: 'owner'
    });
    throw redirect(303, '/today');
  }
};
