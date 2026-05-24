import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Visible in dev to anyone; in prod, only to a superadmin. Acts as the
// Phase 25a visual reference + a11y/Lighthouse baseline.
export const load: PageServerLoad = async ({ locals }) => {
  if (!dev && !locals.user?.isSuperadmin) {
    throw error(404, 'Not found');
  }
  return {};
};
