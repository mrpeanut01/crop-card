/** NFR-06 — browser-side helpers for the /settings/notifications opt-in. */

export type PushSupport = 'supported' | 'unsupported' | 'no-service-worker' | 'permission-denied';

export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function detectPushSupport(env: {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: string | null;
  registered: boolean;
}): PushSupport {
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'permission-denied';
  if (!env.registered) return 'no-service-worker';
  return 'supported';
}

export interface SerializedSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function serializeSubscription(sub: {
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
}): SerializedSubscription | null {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
}
