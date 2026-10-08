import { fail, redirect, type Actions } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { endDemo, fastForwardDemo, isDemoUser, startDemo } from '$lib/server/demo/lifecycle';
import { parseFastForwardChoice, tooFarMessage } from '$lib/demo/fastForward';
import { realNow } from '$lib/server/clock';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  throw redirect(307, '/');
};

function begin(event: Parameters<Actions[string]>[0], blank = false) {
  const user = event.locals.user;
  if (user && !isDemoUser(user)) throw redirect(303, '/today');
  const result = startDemo(event, realNow(), { blank });
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
  throw redirect(303, blank ? '/onboarding' : '/today');
}

export const actions: Actions = {
  start: async (event) => begin(event),
  reset: async (event) => {
    if (!isDemoUser(event.locals.user)) throw redirect(303, '/today');
    return begin(event);
  },
  scratch: async (event) => {
    if (!isDemoUser(event.locals.user)) throw redirect(303, '/today');
    return begin(event, true);
  },
  forward: async (event) => {
    if (!isDemoUser(event.locals.user)) throw redirect(303, '/today');
    const fd = await event.request.formData();
    const choice = parseFastForwardChoice(String(fd.get('to') ?? ''));
    if (!choice) return fail(400, { demoError: t(event.locals.locale, 'entry.demo.ff.errChoice') });
    const now = realNow();
    const result = fastForwardDemo(event, choice, now);
    if (!result.ok) {
      if (result.reason === 'not-demo') throw redirect(303, '/today');
      return fail(400, { demoError: tooFarMessage(event.locals.locale, now, result.offsetMs) });
    }
    throw redirect(303, '/today');
  },
  end: async (event) => {
    if (isDemoUser(event.locals.user)) endDemo(event);
    throw redirect(303, '/');
  }
};
