import { fail, type Actions } from '@sveltejs/kit';
import {
  applyResubscribe,
  applyUnsubscribe,
  requestIp,
  unsubscribeContext
} from '$lib/server/emailPrefs';
import { verifyUnsubscribeToken } from '$lib/server/emailUnsubscribe';
import { t } from '$lib/i18n';
import type { PageServerLoad } from './$types';

/**
 * GET only shows what the link turns off; the POST does it. Mail scanners
 * that prefetch links (Outlook Safe Links and the like) must not quietly
 * switch off someone's decon reminders. The mail client's own Unsubscribe
 * button uses the RFC 8058 one-click POST at /api/email/unsubscribe.
 */
export const load: PageServerLoad = ({ params }) => {
  const claims = verifyUnsubscribeToken(params.token);
  if (!claims) return { status: 'invalid' as const };
  const ctx = unsubscribeContext(claims);
  return {
    status: 'ready' as const,
    scope: claims.scope,
    farmName: ctx.farmName,
    isMember: ctx.isMember,
    prefs: ctx.prefs
  };
};

export const actions: Actions = {
  unsubscribe: async ({ params, request, locals }) => {
    const claims = verifyUnsubscribeToken(params.token);
    if (!claims) return fail(400, { error: t(locals?.locale, 'entry.unsub.err.invalid') });
    const fd = await request.formData();
    const everything = fd.get('everything') === '1';
    const turnedOff = applyUnsubscribe(claims, 'unsubscribe-page', { everything });
    return { done: 'unsubscribed' as const, turnedOff, everything };
  },
  resubscribe: async (event) => {
    const claims = verifyUnsubscribeToken(event.params.token);
    if (!claims) return fail(400, { error: t(event.locals?.locale, 'entry.unsub.err.invalid') });
    const fd = await event.request.formData();
    const requested = fd.getAll('category').filter((v): v is string => typeof v === 'string');
    const result = applyResubscribe(claims, requested, requestIp(event));
    if (!result.ok) {
      if (result.reason === 'not-member') {
        return fail(409, {
          error: t(event.locals?.locale, 'entry.unsub.err.notMember')
        });
      }
      if (result.reason === 'nothing-requested') {
        return fail(400, { error: t(event.locals?.locale, 'entry.unsub.err.pickOne') });
      }
      return fail(400, {
        error: t(event.locals?.locale, 'entry.unsub.err.expired'),
        signIn: true
      });
    }
    return { done: 'resubscribed' as const, turnedOn: result.turnedOn };
  }
};
