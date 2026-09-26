import { error, redirect } from '@sveltejs/kit';
import { loadGardenDesign } from '$lib/server/gardenDesignLoad';
import { getActivePlanningYear } from '$lib/season/planningYear.server';
import { selectablePlanningYears } from '$lib/season/planningYear';
import { listSeen } from '$lib/db/userHints';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, '/');
  const canEdit = user.role === 'owner';
  const now = new Date();
  const activeYear = getActivePlanningYear(now);
  const seasons = [
    ...new Set([now.getFullYear(), ...selectablePlanningYears(now), activeYear])
  ].sort((a, b) => a - b);
  const asked = Number(url.searchParams.get('season'));
  const seasonYear = seasons.includes(asked) ? asked : activeYear;
  const loaded = await loadGardenDesign(params.id, {
    seasonYear,
    readOnlyReason: canEdit ? null : 'role'
  });
  if (!loaded)
    throw error(404, 'This Area has no garden designer. Only gardens and greenhouses do.');
  return {
    ...loaded,
    canEdit,
    role: user.role,
    seasons,
    activeYear,
    hintsSeen: listSeen(user.id).map((h) => h.key)
  };
};
