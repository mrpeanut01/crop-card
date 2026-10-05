import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireMutator } from '$lib/server/auth';
import { listSubscriptionsForUser } from '$lib/db/pushSubscriptions';
import { sendToSubscriptions } from '$lib/server/push/dispatch';
import { testSchema } from '$lib/server/push/validate';
import { readVapidConfig } from '$lib/server/push/webPush';
import { recipientLocale } from '$lib/server/recipientLocale';
import { t } from '$lib/i18n';

/** NFR-06 — send a test notification to the caller's own subscriptions on
 *  the active Owner (optionally just one endpoint). */
export const POST: RequestHandler = async (event) => {
  const u = requireMutator(event);
  if (!u.activeOwnerId) throw error(400, t(event.locals?.locale, 'api.errB.noActiveOwner'));
  const config = readVapidConfig();
  if (!config) throw error(503, t(event.locals?.locale, 'api.errB.pushNotConfigured'));
  const parsed = testSchema.safeParse(await event.request.json().catch(() => ({})));
  if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  const endpoint = parsed.data.endpoint;
  const subs = listSubscriptionsForUser(u.id).filter((s) => !endpoint || s.endpoint === endpoint);
  if (subs.length === 0) throw error(404, t(event.locals?.locale, 'api.errB.noPushSub'));
  const locale = recipientLocale(u.id);
  const summary = await sendToSubscriptions(
    subs,
    {
      title: t(locale, 'push.test.title'),
      body: t(locale, 'push.test.body'),
      url: '/settings/notifications',
      tag: 'cropcard-test',
      kind: 'test'
    },
    config
  );
  return json(summary);
};
