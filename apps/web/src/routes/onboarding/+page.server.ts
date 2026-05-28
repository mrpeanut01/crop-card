import { fail, redirect, type Actions } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { fields, helperAssignments, ownerSubscriptions, owners } from '$lib/db/schema';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/db/sprayers';
import { listCrops } from '$lib/db/crops';
import { loadSeasonSetup } from '$lib/season/setup.server';
import type { PageServerLoad } from './$types';

// #112 — derive a friendly first name from the email when no display
// name exists yet. "sherry.miller@hilltop.farm" → "Sherry". Conservative:
// title-case the first label, fall back to the literal email prefix
// when the parse looks odd (no letters, all-numeric, etc.).
function inferFirstName(email: string | null | undefined): string {
  if (!email) return 'there';
  const local = email.split('@')[0] ?? '';
  const head = local.split(/[._-]/)[0] ?? '';
  if (!/[a-zA-Z]/.test(head)) return local || 'there';
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

export const load: PageServerLoad = ({ locals }) => {
  const user = locals.user ?? null;
  const firstName = inferFirstName(user?.email);

  // Pre-farm state: no activeOwnerId yet. Render the farm-creation form
  // (step 0 of the wizard).
  if (!user?.activeOwnerId) {
    return {
      user,
      firstName,
      farmName: null as string | null,
      progress: null
    };
  }

  // Post-farm state: re-entrant wizard view. Sprint 14 #109 wired a
  // "Re-walk setup tour →" link from /settings; this loader derives the
  // 6-step progress from live DB state so the steps tick as the user
  // completes them across other pages.
  const ownerRow = (() => {
    unscopedQueryNote('onboarding wizard reads the active owner row by id');
    return db.select().from(owners).where(eq(owners.id, user.activeOwnerId!)).get();
  })();
  const blocks = listBlocks();
  const sprayers = listSprayers();
  const plantings = listCrops({ status: 'active', limit: 1 });
  const season = loadSeasonSetup(new Date().getFullYear());

  const progress = {
    farm: !!ownerRow,
    season: !!season,
    block: blocks.length > 0,
    sprayer: sprayers.length > 0,
    // #190 — same kernel-correct predicate as /today bootstrap.
    calibration: sprayers.some((s) => s.calibratedGpa != null && s.calibratedGpa > 0),
    planting: plantings.length > 0
  };

  return {
    user,
    firstName,
    farmName: ownerRow?.name ?? null,
    progress
  };
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
    // After farm creation, stay on /onboarding so the user lands on the
    // 6-step wizard with step 1 ticked. /today is reachable via the top
    // nav once they're ready.
    throw redirect(303, '/onboarding');
  }
};
