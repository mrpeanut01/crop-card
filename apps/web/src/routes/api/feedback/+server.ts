/**
 * POST /api/feedback sends a bug report or idea (#466).
 *
 * Any signed-in person may write, whatever their role, including a partial
 * session before onboarding. API tokens are refused: this is for people in
 * the app. Only the page path is kept (never the query string), plus the
 * app version, user agent and active role. Submit-and-forget: there is no
 * read path for submitters. Nothing is posted to GitHub from here: a
 * superadmin reads each note and chooses what, if anything, to publish.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { submitFeedback } from '$lib/server/feedback';
import { feedbackSubmitSchema } from '$lib/feedback/model';
import { t } from '$lib/i18n';

export const _requestSchema = feedbackSubmitSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  if (event.locals?.authVia === 'bearer') {
    return json({ error: t(event.locals?.locale, 'api.err.feedbackBrowser') }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = feedbackSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error:
          parsed.error.issues[0]?.message ?? t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }
  const result = submitFeedback(user, parsed.data, event.request.headers.get('user-agent'));
  if (!result.ok) {
    return json(
      { error: t(event.locals?.locale, 'feedback.api.rateLimited') },
      { status: 429, headers: { 'retry-after': '3600' } }
    );
  }
  return json({ ok: true, id: result.id }, { status: 201 });
};
