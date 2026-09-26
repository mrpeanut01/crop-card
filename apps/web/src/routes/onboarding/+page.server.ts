import { error, fail, redirect, type Actions, type RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, ownerSubscriptions, owners } from '$lib/db/schema';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import { createField, listFields } from '$lib/db/fields';
import { setSetting } from '$lib/db/settings';
import { LOUDOUN_DEFAULT_LAT_LON, SETTINGS_KEYS } from '$lib/schedule/constants';
import { parseLatLon } from '$lib/schedule/farmLocation';
import { applyFrostPlan, resolveFrostForm } from '$lib/climate/frostSettings.server';
import { setActivePlanningYear } from '$lib/season/planningYear.server';
import { isSelectablePlanningYear } from '$lib/season/planningYear';
import {
  getOnboardingStatus,
  setFarmProfile,
  setOnboardingStatus
} from '$lib/onboarding/state.server';
import {
  GROWING_OPTIONS,
  parseGrowingChoices,
  profileForChoices,
  routeOnboarding,
  starterAreasFor
} from '$lib/onboarding/steps';
import { inferFirstName, suggestedFarmName } from '$lib/onboarding/names';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  const user = locals.user ?? null;
  const hasFarm = !!user?.activeOwnerId;
  const route = routeOnboarding({
    hasFarm,
    isOwner: user?.role === 'owner' && !user.impersonating,
    status: hasFarm ? getOnboardingStatus() : null,
    step: url.searchParams.get('step')
  });
  if (route.kind === 'redirect') throw redirect(route.status, route.location);

  const firstName = inferFirstName(user?.email);
  if (route.screen === 'farm') {
    return {
      screen: 'farm' as const,
      firstName,
      suggestedName: suggestedFarmName(firstName),
      fallbackCenter: LOUDOUN_DEFAULT_LAT_LON,
      farmName: null,
      options: null
    };
  }

  const ownerRow = (() => {
    unscopedQueryNote('onboarding reads the active owner row by id');
    return db
      .select({ name: owners.name })
      .from(owners)
      .where(eq(owners.id, user!.activeOwnerId!))
      .get();
  })();
  return {
    screen: 'growing' as const,
    firstName,
    suggestedName: '',
    fallbackCenter: LOUDOUN_DEFAULT_LAT_LON,
    farmName: ownerRow?.name ?? null,
    options: GROWING_OPTIONS.map((o) => ({ id: o.id, title: o.title, blurb: o.blurb }))
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
  const candidate = base || 'farm';
  for (let i = 0; i < 50; i++) {
    const trial = i === 0 ? candidate : `${candidate}-${i}`;
    const exists = db.select({ id: owners.id }).from(owners).where(eq(owners.slug, trial)).get();
    if (!exists) return trial;
  }
  return `${candidate}-${randomUUID().slice(0, 6)}`;
}

function requireFarmOwner(event: RequestEvent) {
  const user = currentUser(event);
  if (!user) throw redirect(303, '/signin');
  if (!user.activeOwnerId) throw redirect(303, '/onboarding');
  if (user.role !== 'owner') throw error(403, 'owner-only');
  return user;
}

export const actions: Actions = {
  farm: async (event) => {
    const user = currentUser(event);
    if (!user) throw redirect(303, '/signin');

    // #108 / CT-OB-001: a second tab submitting after the farm exists must
    // not mint a duplicate owner and silently switch the session to it.
    if (user.activeOwnerId) {
      return fail(400, {
        error: 'Your farm is already set up. You can rename it any time in Settings.'
      });
    }

    const fd = await event.request.formData();
    const farmName = String(fd.get('farmName') ?? '').trim();
    if (!farmName) return fail(400, { error: 'Give your farm a name to continue.' });
    if (farmName.length > 120) return fail(400, { error: 'Keep the farm name under 120 letters.' });

    const hasLatLon =
      String(fd.get('lat') ?? '').trim() !== '' || String(fd.get('lon') ?? '').trim() !== '';
    const latLon = parseLatLon(fd.get('lat'), fd.get('lon'));
    if (hasLatLon && !latLon) {
      return fail(400, {
        error:
          'That location did not read as a latitude and longitude. Search, use GPS or tap the map.'
      });
    }
    if (latLon) fd.set('frostBasis', 'lookup');
    const frost = latLon ? await resolveFrostForm(fd, latLon) : null;
    if (frost && !frost.ok) return fail(400, { error: frost.error, frostReason: frost.reason });

    const now = new Date(Date.now());
    const planningYear = Number(fd.get('planningYear'));
    const ownerId = `owner_${randomUUID().slice(0, 12)}`;
    const slug = uniqueSlug(slugify(farmName));

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
        .values({ ownerId, planCode: 'free', status: 'trial', createdAt: now, updatedAt: now })
        .run();
    });

    runWithTenant(ownerId, () => {
      setOnboardingStatus('in-progress');
      if (isSelectablePlanningYear(planningYear, now)) setActivePlanningYear(planningYear, now);
      if (latLon) setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify(latLon));
      if (frost?.ok && frost.plan) applyFrostPlan(frost.plan);
    });

    writeSession(event.cookies, {
      id: user.id,
      email: user.email,
      phone: user.phone,
      isSuperadmin: user.isSuperadmin,
      activeOwnerId: ownerId,
      activeRole: 'owner'
    });
    throw redirect(303, '/onboarding');
  },

  growing: async (event) => {
    requireFarmOwner(event);
    const fd = await event.request.formData();
    if (getOnboardingStatus() !== 'in-progress') throw redirect(303, '/today');

    if (fd.get('skip') === '1') {
      setOnboardingStatus('later');
      throw redirect(303, '/today');
    }
    const choices = parseGrowingChoices(fd.getAll('growing'));
    const profile = profileForChoices(choices);
    if (!profile) {
      return fail(400, { error: 'Pick at least one, or choose "Not sure yet".' });
    }
    const existing = listFields();
    db.transaction(() => {
      for (const s of starterAreasFor(choices)) {
        if (existing.some((f) => f.kind === s.kind && f.name === s.name)) continue;
        createField({ name: s.name, kind: s.kind, details: s.details ?? null });
      }
      setFarmProfile(profile);
      setOnboardingStatus('complete');
    });
    throw redirect(303, '/today');
  }
};
