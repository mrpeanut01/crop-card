import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireInteractiveUser } from '$lib/server/auth';
import { getEmailPrefsForUser } from '$lib/db/emailAlertConsents';
import { isEmailSuppressed } from '$lib/db/contactSuppressions';
import { dispatchEmail } from '$lib/server/email';
import { t } from '$lib/i18n';
import { localeField } from '$lib/server/messageLocale';
import { farmNameForOwner } from '$lib/server/emailPrefs';
import { unsubscribeLinks } from '$lib/server/emailUnsubscribe';
import { magicLinkOrigin } from '$lib/server/magicLink';
import { testEmailLimiter } from '$lib/server/testEmailLimit';

/** POST — send the signed-in user one test alert email. Only once they have
 *  opted in to at least one alert kind on this farm. */
export const POST: RequestHandler = async (event) => {
  const u = requireInteractiveUser(event);
  if (!u.activeOwnerId) throw error(400, t(event.locals?.locale, 'api.err.noActiveOwner'));
  if (!u.email) throw error(409, t(event.locals?.locale, 'api.err.addEmailFirst'));
  const prefs = getEmailPrefsForUser(u.id);
  if (!Object.values(prefs).some(Boolean)) {
    throw error(409, t(event.locals?.locale, 'api.err.turnOnAlert'));
  }
  if (isEmailSuppressed(u.email)) {
    throw error(409, t(event.locals?.locale, 'api.err.emailSuppressed'));
  }
  let origin: string;
  try {
    origin = magicLinkOrigin(event.url.origin);
  } catch {
    throw error(503, t(event.locals?.locale, 'api.err.emailNotConfigured'));
  }
  if (!testEmailLimiter.tryTake(u.id)) {
    throw error(429, t(event.locals?.locale, 'api.err.testEmailLimit'));
  }
  const loc = event.locals.locale;
  try {
    await dispatchEmail({
      kind: 'field-alert',
      to: u.email,
      category: null,
      farmName: farmNameForOwner(u.activeOwnerId) ?? t(loc, 'email.yourFarm'),
      title: t(loc, 'email.test.title'),
      body: t(loc, 'email.test.body'),
      actionUrl: new URL('/today', origin).toString(),
      settingsUrl: new URL('/settings/notifications', origin).toString(),
      unsubscribe: unsubscribeLinks(origin, {
        userId: u.id,
        ownerId: u.activeOwnerId,
        scope: 'all'
      }),
      ...localeField(loc)
    });
  } catch (e) {
    console.error('[email] test send failed', e instanceof Error ? e.message : e);
    throw error(503, t(event.locals?.locale, 'api.err.emailSendFailed'));
  }
  return json({ sent: 1, to: u.email });
};
