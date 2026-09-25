import { describe, expect, it, vi } from 'vitest';
import {
  focusOrOpen,
  installSwPush,
  notificationOptions,
  parsePushPayload,
  safeNotificationUrl
} from './swPush';

describe('safeNotificationUrl', () => {
  it('keeps same-origin absolute paths only', () => {
    expect(safeNotificationUrl('/records/spray/abc')).toBe('/records/spray/abc');
    expect(safeNotificationUrl('/spray/decon?sprayer=x')).toBe('/spray/decon?sprayer=x');
    for (const bad of [
      'https://evil.test/',
      '//evil.test/x',
      'javascript:alert(1)',
      '/\\evil',
      42
    ]) {
      expect(safeNotificationUrl(bad)).toBe('/today');
    }
  });
});

describe('parsePushPayload', () => {
  it('parses JSON payloads and clamps fields', () => {
    const p = parsePushPayload(
      JSON.stringify({ title: 'Decon due', body: 'b', url: '/calibrate', tag: 't', kind: 'k' })
    );
    expect(p).toEqual({ title: 'Decon due', body: 'b', url: '/calibrate', tag: 't', kind: 'k' });
    expect(parsePushPayload(JSON.stringify({ title: 'x'.repeat(500) })).title).toHaveLength(120);
  });

  it('falls back safely on empty / non-JSON / hostile payloads', () => {
    expect(parsePushPayload(null)).toEqual({ title: 'CropCard', body: '', url: '/today' });
    expect(parsePushPayload('plain text')).toEqual({
      title: 'CropCard',
      body: 'plain text',
      url: '/today'
    });
    expect(parsePushPayload(JSON.stringify({ url: 'https://evil.test' })).url).toBe('/today');
  });

  it('notificationOptions carries the url in data', () => {
    const opts = notificationOptions(parsePushPayload(JSON.stringify({ url: '/x', tag: 'a' })));
    expect(opts.data.url).toBe('/x');
    expect(opts.tag).toBe('a');
  });
});

describe('focusOrOpen', () => {
  const origin = 'https://cropcard.test';

  it('focuses an existing tab on the exact url', async () => {
    const tab = { url: `${origin}/calibrate`, focus: vi.fn(async () => 0), navigate: vi.fn() };
    const clients = { matchAll: vi.fn(async () => [tab]), openWindow: vi.fn() };
    await focusOrOpen(clients, origin, '/calibrate');
    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('re-uses another same-origin tab by navigating it', async () => {
    const tab = {
      url: `${origin}/today`,
      focus: vi.fn(async () => 0),
      navigate: vi.fn(async () => 0)
    };
    const clients = { matchAll: vi.fn(async () => [tab]), openWindow: vi.fn() };
    await focusOrOpen(clients, origin, '/calibrate');
    expect(tab.navigate).toHaveBeenCalledWith(`${origin}/calibrate`);
    expect(tab.focus).toHaveBeenCalled();
  });

  it('opens a window when no tab exists', async () => {
    const clients = { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => null) };
    await focusOrOpen(clients, origin, '/records/spray/1');
    expect(clients.openWindow).toHaveBeenCalledWith(`${origin}/records/spray/1`);
  });
});

describe('installSwPush', () => {
  function fakeScope() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const scope = {
      location: { origin: 'https://cropcard.test' },
      registration: { showNotification: vi.fn(async () => undefined) },
      clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => null) },
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = fn;
      }
    };
    installSwPush(scope as unknown as Parameters<typeof installSwPush>[0]);
    return { scope, listeners };
  }

  it('push shows a notification from the payload', async () => {
    const { scope, listeners } = fakeScope();
    const waits: Promise<unknown>[] = [];
    listeners.push({
      data: {
        text: () => JSON.stringify({ title: 'Lock soon', body: 'b', url: '/records/spray/1' })
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p)
    });
    await Promise.all(waits);
    expect(scope.registration.showNotification).toHaveBeenCalledWith(
      'Lock soon',
      expect.objectContaining({ body: 'b', data: { url: '/records/spray/1' } })
    );
  });

  it('notificationclick closes the notification and opens its url', async () => {
    const { scope, listeners } = fakeScope();
    const close = vi.fn();
    const waits: Promise<unknown>[] = [];
    listeners.notificationclick({
      notification: { close, data: { url: '/calibrate' } },
      waitUntil: (p: Promise<unknown>) => waits.push(p)
    });
    await Promise.all(waits);
    expect(close).toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('https://cropcard.test/calibrate');
  });
});
