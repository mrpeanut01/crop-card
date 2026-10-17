import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { loadBriefPage } from '$lib/server/garden/briefPage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (!user?.activeOwnerId) throw error(401, t(locals.locale, 'api.err.authRequired'));
  return loadBriefPage({ id: user.id, role: user.role });
};
