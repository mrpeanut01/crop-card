/**
 * POST /api/me/locale — switch the app language: `{ locale: 'en' | 'es' }`
 *
 * Backs the header EN / ES button and the onboarding question. Open to every
 * signed-in role and to a partial session (it touches no farm data). Only
 * an interactive cookie session saves the choice to the user; any other
 * session keeps it in this browser's cookie.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/auth';
import { applyLocaleChoice } from '$lib/server/localeChoice';
import { t } from '$lib/i18n';

export const _requestSchema = z.object({ locale: z.string().min(2).max(8) });

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = _requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const locale = applyLocaleChoice({
    raw: parsed.data.locale,
    cookies: event.cookies,
    userId: user.id,
    saveToUser: event.locals.authVia === 'cookie' && !user.impersonating
  });
  if (!locale) {
    return json({ error: t(event.locals.locale, 'account.language.unavailable') }, { status: 400 });
  }
  return json({ locale });
};
