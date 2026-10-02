import { fail, redirect, type Actions } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { endDemo, isDemoUser, startDemo } from '$lib/server/demo/lifecycle';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  throw redirect(307, '/');
};

function begin(event: Parameters<Actions[string]>[0]) {
  const user = event.locals.user;
  if (user && !isDemoUser(user)) throw redirect(303, '/today');
  const result = startDemo(event);
  if (!result.ok) {
    const key =
      result.reason === 'rate-limited'
        ? 'entry.demo.errRate'
        : result.reason === 'busy'
          ? 'entry.demo.errBusy'
          : 'entry.demo.errOff';
    return fail(result.reason === 'disabled' ? 404 : 429, {
      demoError: t(event.locals.locale, key)
    });
  }
  throw redirect(303, '/today');
}

export const actions: Actions = {
  start: async (event) => begin(event),
  reset: async (event) => {
    if (!isDemoUser(event.locals.user)) throw redirect(303, '/today');
    return begin(event);
  },
  end: async (event) => {
    if (isDemoUser(event.locals.user)) endDemo(event);
    throw redirect(303, '/');
  }
};
