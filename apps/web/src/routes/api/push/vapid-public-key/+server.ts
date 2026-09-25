import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { readVapidConfig } from '$lib/server/push/webPush';

/** NFR-06 — the application-server key the browser needs for
 *  `pushManager.subscribe`. `enabled: false` when VAPID is not configured. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const config = readVapidConfig();
  return json(
    { enabled: config !== null, publicKey: config?.publicKey ?? null },
    { headers: { 'cache-control': 'no-store' } }
  );
};
