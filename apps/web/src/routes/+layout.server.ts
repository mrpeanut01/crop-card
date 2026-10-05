import type { LayoutServerLoad } from './$types';
import { listSprayers } from '$lib/server/sprayers';
import { needsDecon } from '$lib/equipment/decon';
import { getRegistryStats } from '$lib/server/registry';
import { activeAssignmentsForUser } from '$lib/db/users';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';
import { farmTimeZone, profileFor } from '$lib/db/userProfile';
import { DEFAULT_PREFS } from '$lib/prefs';
import { identityName } from '$lib/identity';
import { expiringSoon, lowStockItems } from '$lib/db/stock';
import { deriveWinterizeAlerts, startOfSeason } from '$lib/today/winterizeAlert';
import { equipmentIdsActiveBefore } from '$lib/db/equipment';
import { buildNavAlerts, type NavAlert } from '$lib/today/navAlerts';
import { PLANS } from '$lib/billing/plans';
import { resolvePlan } from '$lib/server/billing/plans';
import { animalsNavLabel } from '$lib/animals/profile.server';
import { enabledLocales } from '$lib/i18n/locales';
import { demoExpiryFor } from '$lib/server/demo/lifecycle';

export const load: LayoutServerLoad = ({ locals }) => {
  // A sprayer is "dirty" when it has carried chemistry that has not yet been
  // followed by a decon. Surfaced as a site-wide banner so an operator can't
  // forget — the kernel will block the next spray on this sprayer anyway,
  // but a visible reminder beats a STOP card mid-mix (FR-05).
  //
  // Phase 18a: only load sprayers when authenticated. Unauthenticated
  // requests (e.g., /signin, /manifest.webmanifest) skip the query so they
  // don't trip `TenantContextMissingError` in tenant-scoped repos.
  const sprayers = locals.user?.activeOwnerId ? listSprayers() : [];
  const dirtySprayers = locals.user?.activeOwnerId
    ? sprayers
        .filter((s) =>
          needsDecon({
            lastChemistryClass: s.lastChemistryClass,
            lastUsedAt: s.lastSprayedAt,
            lastDeconAt: s.lastDeconAt
          })
        )
        .map((s) => ({
          id: s.id,
          label: s.label,
          lastChemistryClass: s.lastChemistryClass
        }))
    : [];

  let navAlerts: NavAlert[] = [];
  if (locals.user?.activeOwnerId) {
    try {
      navAlerts = buildNavAlerts(
        {
          dirtySprayers,
          winterize: deriveWinterizeAlerts(
            sprayers,
            Date.now(),
            equipmentIdsActiveBefore(startOfSeason(Date.now(), farmTimeZone())),
            farmTimeZone()
          ),
          lowStock: lowStockItems(),
          expiring: expiringSoon(30).map((e) => ({
            itemId: e.item.id,
            itemName: e.item.displayName,
            category: e.item.category,
            daysUntilExpiry: e.lot.daysUntilExpiry ?? 0
          }))
        },
        locals.locale
      );
    } catch (err) {
      console.error('[layout] failed to build nav alerts', err);
    }
  }

  // Phase 18d: surface the active Owner + all assignments to the layout
  // so the top-nav chip + Owner-switch menu can render without an extra
  // round-trip. Empty when unauthenticated.
  let activeOwner: { id: string; name: string; slug: string } | null = null;
  let availableOwners: Array<{ id: string; name: string; slug: string; role: string }> = [];
  if (locals.user) {
    try {
      const assignments = activeAssignmentsForUser(locals.user.id);
      if (assignments.length > 0) {
        unscopedQueryNote("top-nav hydrates owner names for the user's assigned tenants");
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
        availableOwners = assignments
          .map((a) => {
            const o = byId.get(a.ownerId);
            if (!o) return null;
            return { id: o.id, name: o.name, slug: o.slug, role: a.roleWithinOwner as string };
          })
          .filter((o): o is { id: string; name: string; slug: string; role: string } => o !== null);
        if (locals.user.activeOwnerId) {
          const ownerInfo = byId.get(locals.user.activeOwnerId);
          if (ownerInfo) activeOwner = ownerInfo;
        }
      }
      if (locals.user.impersonating && !activeOwner && locals.user.activeOwnerId) {
        unscopedQueryNote(
          'superadmin impersonating an Owner they have no helper_assignment for; fetch the target name for the banner (#223)'
        );
        const impersonated = db
          .select({ id: owners.id, name: owners.name, slug: owners.slug })
          .from(owners)
          .where(eq(owners.id, locals.user.activeOwnerId))
          .get();
        if (impersonated) activeOwner = impersonated;
      }
    } catch (err) {
      console.error('[tenant] layout failed to hydrate owners list', err);
    }
  }

  let billingGrace: { planName: string; graceEndsAt: number } | null = null;
  if (locals.user?.activeOwnerId && locals.user.role === 'owner') {
    try {
      const plan = resolvePlan(locals.user.activeOwnerId);
      if (plan.source === 'grace' && plan.graceEndsAt) {
        billingGrace = { planName: PLANS[plan.plan].name, graceEndsAt: plan.graceEndsAt };
      }
    } catch (err) {
      console.error('[billing] layout failed to resolve the plan', err);
    }
  }

  let animalsLabel: string | null = null;
  if (locals.user?.activeOwnerId) {
    try {
      animalsLabel = animalsNavLabel();
    } catch (err) {
      console.error('[layout] failed to read the animals nav entry', err);
    }
  }

  const profile = locals.user ? profileFor(locals.user.id) : null;

  let demo: { expiresAt: number } | null = null;
  try {
    const expiresAt = demoExpiryFor(locals.user);
    if (expiresAt !== null) demo = { expiresAt };
  } catch (err) {
    console.error('[demo] layout failed to read the demo expiry', err);
  }

  const pluginLoadFailures =
    locals.user && (locals.user.role === 'owner' || locals.user.isSuperadmin)
      ? getRegistryStats().failures.length
      : 0;

  return {
    locale: locals.locale ?? 'en',
    locales: [...enabledLocales()],
    pluginLoadFailures,
    user: locals.user
      ? {
          id: locals.user.id,
          email: locals.user.email,
          phone: locals.user.phone,
          name: identityName({ ...locals.user, displayName: profile?.displayName }),
          avatarUrl: profile?.avatarUrl ?? null,
          role: locals.user.role,
          activeOwnerId: locals.user.activeOwnerId,
          isSuperadmin: locals.user.isSuperadmin,
          impersonating: locals.user.impersonating
        }
      : null,
    prefs: { ...(profile?.prefs ?? DEFAULT_PREFS), locale: locals.locale ?? 'en' },
    dirtySprayers,
    navAlerts,
    animalsNavLabel: animalsLabel,
    activeOwner,
    availableOwners,
    billingGrace,
    demo
  };
};
