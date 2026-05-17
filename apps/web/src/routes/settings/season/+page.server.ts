import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { requireOwner } from '$lib/server/auth';
import { loadSeasonSetup } from '$lib/season/setup.server';

export const load: PageServerLoad = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw redirect(303, '/owner-picker');

  const currentYear = new Date().getFullYear();
  return {
    currentYear,
    existing: loadSeasonSetup(currentYear),
    lastYearSetup: loadSeasonSetup(currentYear - 1)
  };
};
