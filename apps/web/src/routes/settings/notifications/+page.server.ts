import { error } from '@sveltejs/kit';
import { listSubscriptionsForUser } from '$lib/db/pushSubscriptions';
import { readVapidConfig } from '$lib/server/push/webPush';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');
  const config = readVapidConfig();
  return {
    configured: config !== null,
    publicKey: config?.publicKey ?? null,
    canSubscribe: locals.user.role !== 'inspector',
    subscriptions: listSubscriptionsForUser(locals.user.id).map((s) => ({
      endpoint: s.endpoint,
      prefs: s.prefs,
      lastSuccessAt: s.lastSuccessAt,
      failureCount: s.failureCount
    }))
  };
};
