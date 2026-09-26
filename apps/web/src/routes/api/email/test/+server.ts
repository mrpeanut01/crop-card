import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireInteractiveUser } from '$lib/server/auth';
import { getEmailPrefsForUser } from '$lib/db/emailAlertConsents';
import { isEmailSuppressed } from '$lib/db/contactSuppressions';
import { dispatchEmail } from '$lib/server/email';
import { farmNameForOwner } from '$lib/server/emailPrefs';
import { unsubscribeLinks } from '$lib/server/emailUnsubscribe';
import { magicLinkOrigin } from '$lib/server/magicLink';

/** POST — send the signed-in user one test alert email. Only once they have
 *  opted in to at least one alert kind on this farm. */
export const POST: RequestHandler = async (event) => {
  const u = requireInteractiveUser(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  if (!u.email) throw error(409, 'Add an email address in Account settings first.');
  const prefs = getEmailPrefsForUser(u.id);
  if (!Object.values(prefs).some(Boolean)) {
    throw error(409, 'Turn on at least one email alert first.');
  }
  if (isEmailSuppressed(u.email)) {
    throw error(409, 'Your email provider reported this address as unsubscribed or bouncing.');
  }
  let origin: string;
  try {
    origin = magicLinkOrigin(event.url.origin);
  } catch {
    throw error(503, "Email links aren't configured on this server");
  }
  try {
    await dispatchEmail({
      kind: 'field-alert',
      to: u.email,
      category: null,
      farmName: farmNameForOwner(u.activeOwnerId) ?? 'your farm',
      title: 'CropCard test email',
      body: 'Alert emails are working. Real alerts look like this one.',
      actionUrl: new URL('/today', origin).toString(),
      settingsUrl: new URL('/settings/notifications', origin).toString(),
      unsubscribe: unsubscribeLinks(origin, {
        userId: u.id,
        ownerId: u.activeOwnerId,
        scope: 'all'
      })
    });
  } catch (e) {
    console.error('[email] test send failed', e instanceof Error ? e.message : e);
    throw error(503, "We couldn't send the email just now.");
  }
  return json({ sent: 1, to: u.email });
};
