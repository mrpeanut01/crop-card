import type { LayoutServerLoad } from './$types';
import { listSprayers } from '$lib/server/sprayers';
import { activeAssignmentsForUser } from '$lib/db/users';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { inArray } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';

export const load: LayoutServerLoad = ({ locals }) => {
  // A sprayer is "dirty" when it has carried chemistry that has not yet been
  // followed by a decon. Surfaced as a site-wide banner so an operator can't
  // forget — the kernel will block the next spray on this sprayer anyway,
  // but a visible reminder beats a STOP card mid-mix (FR-05).
  //
  // Phase 18a: only load sprayers when authenticated. Unauthenticated
  // requests (e.g., /signin, /manifest.webmanifest) skip the query so they
  // don't trip `TenantContextMissingError` in tenant-scoped repos.
  const dirtySprayers = locals.user?.activeOwnerId
    ? listSprayers()
        .filter((s) => {
          if (!s.lastChemistryClass) return false;
          if (!s.lastSprayedAt) return false;
          if (s.lastDeconAt && s.lastDeconAt >= s.lastSprayedAt) return false;
          return true;
        })
        .map((s) => ({
          id: s.id,
          label: s.label,
          lastChemistryClass: s.lastChemistryClass
        }))
    : [];

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
    } catch (err) {
      console.error('[tenant] layout failed to hydrate owners list', err);
    }
  }

  return {
    user: locals.user
      ? {
          id: locals.user.id,
          email: locals.user.email,
          role: locals.user.role,
          activeOwnerId: locals.user.activeOwnerId,
          isSuperadmin: locals.user.isSuperadmin,
          impersonating: locals.user.impersonating
        }
      : null,
    dirtySprayers,
    activeOwner,
    availableOwners
  };
};
