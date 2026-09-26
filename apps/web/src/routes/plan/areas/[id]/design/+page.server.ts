import { error, redirect } from '@sveltejs/kit';
import { loadGardenDesign } from '$lib/server/gardenDesignLoad';
import { getActivePlanningYear } from '$lib/season/planningYear.server';
import { listSeen } from '$lib/db/userHints';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) throw redirect(303, '/');
  const canEdit = user.role === 'owner';
  const loaded = await loadGardenDesign(params.id, {
    seasonYear: getActivePlanningYear(),
    readOnlyReason: canEdit ? null : 'role'
  });
  if (!loaded)
    throw error(404, 'This Area has no garden designer. Only gardens and greenhouses do.');
  return {
    ...loaded,
    canEdit,
    role: user.role,
    hintsSeen: listSeen(user.id).map((h) => h.key)
  };
};
