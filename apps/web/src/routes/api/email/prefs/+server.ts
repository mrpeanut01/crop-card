import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireInteractiveUser } from '$lib/server/auth';
import { isReadOnly } from '$lib/server/session';
import { getEmailPrefsForUser } from '$lib/db/emailAlertConsents';
import { isEmailAlertCategory } from '$lib/email/alertCategories';
import { requestIp, setEmailAlertPref } from '$lib/server/emailPrefs';

/** GET — the signed-in user's alert email choices on the active Owner. */
export const GET: RequestHandler = (event) => {
  const u = requireInteractiveUser(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  return json({ prefs: getEmailPrefsForUser(u.id), email: u.email });
};

/**
 * POST { category, enabled } — opt in to or out of one alert kind by email.
 * Consent is a person's own choice, so it needs the signed-in browser
 * session: API tokens and impersonation are refused, and the opt-in records
 * when, from where and the client IP.
 */
export const POST: RequestHandler = async (event) => {
  const u = requireInteractiveUser(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  if (isReadOnly(u.role)) throw error(403, 'inspector accounts cannot receive alerts');
  const body = (await event.request.json().catch(() => null)) as {
    category?: unknown;
    enabled?: unknown;
  } | null;
  if (!isEmailAlertCategory(body?.category) || typeof body?.enabled !== 'boolean') {
    throw error(400, 'category and enabled are required');
  }
  if (body.enabled && !u.email) {
    throw error(409, 'Add an email address in Account settings first.');
  }
  const prefs = setEmailAlertPref({
    userId: u.id,
    email: u.email,
    category: body.category,
    enabled: body.enabled,
    ip: requestIp(event)
  });
  return json({ prefs });
};
