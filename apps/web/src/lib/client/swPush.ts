/**
 * NFR-06 — service-worker `push` + `notificationclick` handlers.
 *
 * Import-free on purpose: vite.config.ts compiles this file verbatim into a
 * classic script (`sw-push.js`) that the generated Workbox SW loads via
 * `importScripts`, next to `sw-tenant.js`. The same source is unit-tested.
 */

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  kind?: string;
}

const DEFAULT_TITLE = 'CropCard';
const DEFAULT_URL = '/today';
const MAX_TITLE = 120;
const MAX_BODY = 400;

/** Only same-origin absolute paths may be opened from a notification. */
export function safeNotificationUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_URL;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return DEFAULT_URL;
  }
  return value;
}

export function parsePushPayload(raw: string | null | undefined): PushNotificationPayload {
  let data: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch {
      data = { body: raw };
    }
  }
  const title =
    typeof data.title === 'string' && data.title.trim()
      ? data.title.slice(0, MAX_TITLE)
      : DEFAULT_TITLE;
  const body = typeof data.body === 'string' ? data.body.slice(0, MAX_BODY) : '';
  const out: PushNotificationPayload = { title, body, url: safeNotificationUrl(data.url) };
  if (typeof data.tag === 'string' && data.tag) out.tag = data.tag.slice(0, 200);
  if (typeof data.kind === 'string' && data.kind) out.kind = data.kind.slice(0, 64);
  return out;
}

export function notificationOptions(p: PushNotificationPayload): {
  body: string;
  tag?: string;
  icon: string;
  badge: string;
  data: { url: string; kind?: string };
} {
  const opts: ReturnType<typeof notificationOptions> = {
    body: p.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: p.url }
  };
  if (p.tag) opts.tag = p.tag;
  if (p.kind) opts.data.kind = p.kind;
  return opts;
}

interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}

interface ClientsLike {
  matchAll(opts: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/** Focus a tab already on `url`; else re-use any open tab; else open one. */
export async function focusOrOpen(
  clients: ClientsLike,
  origin: string,
  path: string
): Promise<void> {
  const target = new URL(safeNotificationUrl(path), origin).href;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const exact = windows.find((w) => w.url === target);
  if (exact) {
    await exact.focus();
    return;
  }
  const sameOrigin = windows.find((w) => {
    try {
      return new URL(w.url).origin === origin;
    } catch {
      return false;
    }
  });
  if (sameOrigin && sameOrigin.navigate) {
    await sameOrigin.navigate(target);
    await sameOrigin.focus();
    return;
  }
  await clients.openWindow(target);
}

interface SwPushScopeLike {
  location: { origin: string };
  registration: {
    showNotification(
      title: string,
      options: ReturnType<typeof notificationOptions>
    ): Promise<unknown>;
  };
  clients: ClientsLike;
  addEventListener(
    type: 'push',
    listener: (event: {
      data?: { text(): string } | null;
      waitUntil(p: Promise<unknown>): void;
    }) => void
  ): void;
  addEventListener(
    type: 'notificationclick',
    listener: (event: {
      notification: { close(): void; data?: { url?: unknown } | null };
      waitUntil(p: Promise<unknown>): void;
    }) => void
  ): void;
}

export function installSwPush(scope: SwPushScopeLike): void {
  scope.addEventListener('push', (event) => {
    let raw: string | null = null;
    try {
      raw = event.data ? event.data.text() : null;
    } catch {
      raw = null;
    }
    const payload = parsePushPayload(raw);
    event.waitUntil(
      scope.registration.showNotification(payload.title, notificationOptions(payload))
    );
  });
  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = safeNotificationUrl(event.notification.data?.url);
    event.waitUntil(focusOrOpen(scope.clients, scope.location.origin, url));
  });
}
