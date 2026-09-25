/**
 * NFR-06 — per-user push subscription management, scoped to the active Owner.
 *
 * POST   — register this browser's PushSubscription (+ optional prefs).
 * PATCH  — change which alert kinds this browser receives.
 * DELETE — unregister this browser.
 *
 * Any non-inspector member may manage their OWN subscriptions; every lookup
 * keys on (active Owner, session user, endpoint), so a user can never read or
 * touch someone else's row.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireMutator } from '$lib/server/auth';
import {
  deleteSubscriptionForUser,
  getSubscriptionForUser,
  updatePrefsForUser,
  upsertSubscription,
  type PushSubscriptionRecord
} from '$lib/db/pushSubscriptions';
import { DEFAULT_PUSH_PREFS, mergePushPrefs } from '$lib/push/prefs';
import { prefsSchema, subscribeSchema, unsubscribeSchema } from '$lib/server/push/validate';
import { readVapidConfig } from '$lib/server/push/webPush';

function view(sub: PushSubscriptionRecord) {
  return {
    id: sub.id,
    endpoint: sub.endpoint,
    prefs: sub.prefs,
    createdAt: sub.createdAt,
    lastSuccessAt: sub.lastSuccessAt,
    failureCount: sub.failureCount
  };
}

async function body(event: Parameters<RequestHandler>[0]): Promise<unknown> {
  return event.request.json().catch(() => null);
}

export const POST: RequestHandler = async (event) => {
  const u = requireMutator(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  if (!readVapidConfig()) throw error(503, "Push isn't configured on this server");
  const parsed = subscribeSchema.safeParse(await body(event));
  if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  const { subscription, prefs } = parsed.data;
  const existing = getSubscriptionForUser(u.id, subscription.endpoint);
  const sub = upsertSubscription({
    userId: u.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    prefs: prefs ? mergePushPrefs(existing?.prefs ?? DEFAULT_PUSH_PREFS, prefs) : undefined
  });
  return json({ subscription: view(sub) }, { status: existing ? 200 : 201 });
};

export const PATCH: RequestHandler = async (event) => {
  const u = requireMutator(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  const parsed = prefsSchema.safeParse(await body(event));
  if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  const existing = getSubscriptionForUser(u.id, parsed.data.endpoint);
  if (!existing) throw error(404, 'subscription not found');
  const updated = updatePrefsForUser(
    u.id,
    parsed.data.endpoint,
    mergePushPrefs(existing.prefs, parsed.data.prefs)
  );
  if (!updated) throw error(404, 'subscription not found');
  return json({ subscription: view(updated) });
};

export const DELETE: RequestHandler = async (event) => {
  const u = requireMutator(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  const parsed = unsubscribeSchema.safeParse(await body(event));
  if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  const removed = deleteSubscriptionForUser(u.id, parsed.data.endpoint);
  return json({ removed });
};
