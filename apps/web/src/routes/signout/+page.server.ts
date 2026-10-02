import { redirect, type Actions } from '@sveltejs/kit';
import { clearSession } from '$lib/server/session';
import { endDemo, isDemoUser } from '$lib/server/demo/lifecycle';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  throw redirect(307, '/');
};

export const actions: Actions = {
  default: (event) => {
    if (isDemoUser(event.locals.user)) endDemo(event);
    else clearSession(event.cookies);
    throw redirect(303, '/');
  }
};
