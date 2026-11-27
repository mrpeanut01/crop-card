import { error } from '@sveltejs/kit';
import { aiLimitReason } from '$lib/billing/aiLimit';
import { t } from '$lib/i18n';
import { savedFarmLatLon } from '$lib/schedule/settings';
import { aiLimitOf } from '$lib/server/aiDegrade';
import { checkGuard } from '$lib/server/aiGuard';
import { getApiKey } from '$lib/server/scanResult';
import { loadSiteData } from '$lib/server/siteFinder/run';
import { PLANTED_AREA_KINDS } from '$lib/siteFinder/candidates';
import type { PageServerLoad } from './$types';

/** Tenant-scoped reads only. No soil, photo or AI call happens here. */
export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (!user?.activeOwnerId) throw error(401, t(locals.locale, 'api.err.authRequired'));
  const canEdit = user.role === 'owner';
  if (!canEdit) {
    return {
      canEdit,
      center: null,
      areas: [],
      obstacles: [],
      water: [],
      overlapChoices: [],
      ai: null
    };
  }
  const site = loadSiteData();
  const seen = new Set<string>();
  const overlapChoices = site.areas
    .filter((a) => a.id.startsWith('area:') && PLANTED_AREA_KINDS.has(a.kind))
    .filter((a) => !seen.has(a.areaId) && !!seen.add(a.areaId))
    .map((a) => ({ id: a.areaId, name: a.name }));

  let ai: { available: boolean; reason: string | null };
  if (!getApiKey()) {
    ai = { available: false, reason: t(locals.locale, 'sitefinder.ai.noKey') };
  } else {
    const guard = checkGuard(user.id, 'site-finder');
    const limit = aiLimitOf(guard);
    ai = guard.ok
      ? { available: true, reason: null }
      : {
          available: false,
          reason: limit ? aiLimitReason(limit, locals.locale) : guard.message
        };
  }
  return {
    canEdit,
    center: savedFarmLatLon(),
    areas: site.areas,
    obstacles: site.obstacles,
    water: site.water,
    overlapChoices,
    ai
  };
};
