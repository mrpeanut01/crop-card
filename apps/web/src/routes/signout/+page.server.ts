import { redirect, type Actions } from '@sveltejs/kit';
import { clearSession } from '$lib/server/session';

export const actions: Actions = {
  default: ({ cookies }) => {
    clearSession(cookies);
    throw redirect(303, '/');
  }
};
