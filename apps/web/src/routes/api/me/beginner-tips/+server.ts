/**
 * POST /api/me/beginner-tips — the signed-in user's beginner tips:
 * `{ enabled }` turns them on or off, `{ reset: true }` forgets which tips
 * were dismissed so each shows once more. Per user, on every farm.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { forgetTips, listSeen } from '$lib/db/userHints';
import { setBeginnerTips } from '$lib/db/userProfile';
import { beginnerTipsPostSchema } from '$lib/hints';
import { requireUser } from '$lib/server/auth';
import { t } from '$lib/i18n';

export const _requestSchema = beginnerTipsPostSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = beginnerTipsPostSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { enabled, reset } = parsed.data;
  if (enabled !== undefined) setBeginnerTips(user.id, enabled);
  const forgotten = reset ? forgetTips(user.id) : 0;
  return json({
    enabled: enabled ?? user.beginnerTips === true,
    forgotten,
    hints: listSeen(user.id)
  });
};
