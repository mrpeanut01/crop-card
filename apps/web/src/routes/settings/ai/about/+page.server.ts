import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSetting, setSetting } from '$lib/db/settings';
import { ASSISTANT_SKIPPED_SETTING } from '$lib/onboarding/gettingStarted';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  return {
    canDecide: locals.user.role === 'owner',
    skipped: getSetting(ASSISTANT_SKIPPED_SETTING) === '1'
  };
};

export const actions: Actions = {
  skip: ({ locals }) => {
    if (locals.user?.role !== 'owner') throw error(403, 'owner role required');
    setSetting(ASSISTANT_SKIPPED_SETTING, '1');
    throw redirect(303, '/today');
  }
};
