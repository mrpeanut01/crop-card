import { error, fail, redirect, type Actions, type RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { fields, helperAssignments, ownerSubscriptions, owners } from '$lib/db/schema';
import { currentUser } from '$lib/server/auth';
import { writeSession } from '$lib/server/session';
import { runWithTenant, tenantValues, unscopedQueryNote } from '$lib/db/tenant';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listShadeSources } from '$lib/db/shadeSources';
import { createEquipment, listEquipment } from '$lib/db/equipment';
import { setSetting, getSetting } from '$lib/db/settings';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import {
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAT_LON,
  SETTINGS_KEYS
} from '$lib/schedule/constants';
import { normalizeFrost, parseLatLon } from '$lib/schedule/farmLocation';
import { loadSeasonSetup } from '$lib/season/setup.server';
import {
  getActivePlanningYear,
  loadPlanningYearView,
  setActivePlanningYear
} from '$lib/season/planningYear.server';
import {
  isSelectablePlanningYear,
  selectablePlanningYears,
  suggestPlanningYear,
  suggestionReason,
  type PlanningYearView
} from '$lib/season/planningYear';
import {
  confirmImplements,
  getOnboardingStatus,
  loadOnboardingProgress,
  setOnboardingStatus
} from '$lib/onboarding/state.server';
import { nextAfter, resolveStep, type OnboardingProgress } from '$lib/onboarding/steps';
import { planImplementCreates, sameImplement } from '$lib/onboarding/implements';
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

const NO_FARM: OnboardingProgress = {
  farm: false,
  location: false,
  fields: false,
  implements: false,
  season: false,
  plan: false
};

export const load: PageServerLoad = ({ locals, url }) => {
  const user = locals.user ?? null;
  const firstName = inferFirstName(user?.email);

  if (!user?.activeOwnerId) {
    const now = new Date();
    const planningYear: PlanningYearView = {
      activeYear: suggestPlanningYear(now),
      suggestedYear: suggestPlanningYear(now),
      suggestionReason: suggestionReason(now),
      options: selectablePlanningYears(now),
      pastYears: [],
      chosen: false
    };
    return {
      planningYear,
      firstName,
      farmName: null as string | null,
      progress: NO_FARM,
      step: 'farm' as const,
      canEdit: false,
      status: null,
      location: null,
      map: null,
      implements: null,
      season: null,
      summary: null
    };
  }

  const ownerRow = (() => {
    unscopedQueryNote('onboarding wizard reads the active owner row by id');
    return db.select().from(owners).where(eq(owners.id, user.activeOwnerId!)).get();
  })();
  const year = getActivePlanningYear();
  const progress = loadOnboardingProgress(year);
  const step = resolveStep(url.searchParams.get('step'), progress);
  const center = hasFarmLatLon() ? getFarmLatLon() : null;

  const location =
    step === 'location'
      ? {
          current: center,
          fallback: LOUDOUN_DEFAULT_LAT_LON,
          lastFrost: getSetting(SETTINGS_KEYS.lastFrost) ?? null,
          firstFrost: getSetting(SETTINGS_KEYS.firstFrost) ?? null,
          defaultLastFrost: LOUDOUN_DEFAULT_LAST_FROST_MMDD,
          defaultFirstFrost: LOUDOUN_DEFAULT_FIRST_FROST_MMDD
        }
      : null;

  const map =
    step === 'fields'
      ? {
          blocks: listBlocks(),
          fields: listFields(),
          shadeSources: listShadeSources(),
          center
        }
      : null;

  const equipment = step === 'implements' || step === 'plan' ? listEquipment() : [];
  const implementsData =
    step === 'implements'
      ? {
          templates: SEED_EQUIPMENT_TEMPLATES.map((t) => ({
            templateId: t.templateId,
            type: t.type,
            category: t.category,
            label: t.label,
            description: t.description
          })),
          owned: equipment
            .filter((e) => !e.retiredAt)
            .map((e) => ({ id: e.id, type: e.type, label: e.label })),
          ownedTemplateIds: SEED_EQUIPMENT_TEMPLATES.filter((t) =>
            equipment.some((e) => sameImplement(e, t))
          ).map((t) => t.templateId)
        }
      : null;

  const season =
    step === 'season'
      ? {
          planningYear: loadPlanningYearView(),
          existing: loadSeasonSetup(year),
          lastYearSetup: loadSeasonSetup(year - 1),
          currentYear: year
        }
      : null;

  const summary =
    step === 'plan'
      ? (() => {
          const blocks = listBlocks();
          const sprayers = equipment.filter((e) => e.type === 'sprayer' && !e.retiredAt);
          return {
            blockCount: blocks.length,
            acres: Number(blocks.reduce((sum, b) => sum + (b.acres ?? 0), 0).toFixed(2)),
            implementCount: equipment.filter((e) => !e.retiredAt).length,
            uncalibratedSprayers: sprayers.filter(
              (s) => !(s.state.calibratedGpa != null && s.state.calibratedGpa > 0)
            ).length,
            location: center
          };
        })()
      : null;

  return {
    firstName,
    farmName: ownerRow?.name ?? null,
    progress,
    step,
    planningYear: null,
    canEdit: user.role === 'owner',
    status: getOnboardingStatus(),
    location,
    map,
    implements: implementsData,
    season,
    summary
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

function requireFarmOwner(event: RequestEvent) {
  const user = currentUser(event);
  if (!user) throw redirect(303, '/signin');
  if (!user.activeOwnerId) throw redirect(303, '/onboarding');
  if (user.role !== 'owner') throw error(403, 'owner-only');
  return user;
}

function continueTo(from: Parameters<typeof nextAfter>[0]): never {
  const next = nextAfter(from, loadOnboardingProgress(getActivePlanningYear()));
  throw redirect(303, `/onboarding?step=${next}`);
}

export const actions: Actions = {
  farm: async (event) => {
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
          'Your farm is already set up. Visit Settings to rename it, or re-walk the setup guide at /onboarding.'
      });
    }

    const fd = await event.request.formData();
    const farmName = String(fd.get('farmName') ?? '').trim();
    const location = String(fd.get('location') ?? '').trim();
    if (!farmName) return fail(400, { error: 'farmName required' });
    const now = new Date(Date.now());
    const planningYearRaw = Number(fd.get('planningYear'));
    const planningYear = isSelectablePlanningYear(planningYearRaw, now)
      ? planningYearRaw
      : suggestPlanningYear(now);

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
      setOnboardingStatus('in-progress');
      setActivePlanningYear(planningYear, now);
      db.insert(fields)
        .values(
          tenantValues({
            id: randomUUID(),
            name: 'Home Field',
            location: location || null,
            createdAt: now
          })
        )
        .run();
    });

    writeSession(event.cookies, {
      id: user.id,
      email: user.email,
      phone: user.phone,
      isSuperadmin: user.isSuperadmin,
      activeOwnerId: ownerId,
      activeRole: 'owner'
    });
    throw redirect(303, '/onboarding?step=location');
  },
  location: async (event) => {
    requireFarmOwner(event);
    const fd = await event.request.formData();
    const latLon = parseLatLon(fd.get('lat'), fd.get('lon'));
    if (!latLon) {
      return fail(400, {
        error: 'Drop a pin on the map, use your current location, or type a latitude and longitude.'
      });
    }
    setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify(latLon));
    const lastFrost = normalizeFrost(fd.get('lastFrost'));
    if (lastFrost) setSetting(SETTINGS_KEYS.lastFrost, lastFrost);
    const firstFrost = normalizeFrost(fd.get('firstFrost'));
    if (firstFrost) setSetting(SETTINGS_KEYS.firstFrost, firstFrost);
    continueTo('location');
  },

  implements: async (event) => {
    requireFarmOwner(event);
    const fd = await event.request.formData();
    const selected = fd.getAll('templateId').map(String);
    const types = fd.getAll('customType').map(String);
    const labels = fd.getAll('customLabel').map(String);
    const custom = labels.map((label, i) => ({ label, type: types[i] ?? '' }));
    const { creates, errors } = planImplementCreates(
      selected,
      custom,
      SEED_EQUIPMENT_TEMPLATES,
      listEquipment()
    );
    if (errors.length > 0) return fail(400, { error: errors.join(' ') });
    db.transaction(() => {
      for (const c of creates) createEquipment(c);
      confirmImplements();
    });
    continueTo('implements');
  },

  finish: async (event) => {
    requireFarmOwner(event);
    const fd = await event.request.formData();
    setOnboardingStatus('complete');
    throw redirect(303, fd.get('dest') === 'today' ? '/today' : '/plan?wizard=allocation');
  },

  later: async (event) => {
    requireFarmOwner(event);
    if (getOnboardingStatus() !== 'complete') setOnboardingStatus('later');
    throw redirect(303, '/today');
  }
};
