import { describe, expect, it } from 'vitest';
import { DEFAULT_PUSH_PREFS, mergePushPrefs, parsePushPrefs } from './prefs';
import { detectPushSupport, urlBase64ToUint8Array } from '$lib/client/pushClient';

describe('push prefs', () => {
  it('parse falls back to defaults on junk and ignores unknown keys', () => {
    expect(parsePushPrefs(null)).toEqual(DEFAULT_PUSH_PREFS);
    expect(parsePushPrefs('not json')).toEqual(DEFAULT_PUSH_PREFS);
    expect(parsePushPrefs('[]')).toEqual(DEFAULT_PUSH_PREFS);
    expect(parsePushPrefs('{"decon-due":false,"evil":true,"spring-calibration":"no"}')).toEqual({
      ...DEFAULT_PUSH_PREFS,
      'decon-due': false
    });
  });

  it('merge only applies boolean values for known kinds', () => {
    const base = { ...DEFAULT_PUSH_PREFS };
    expect(mergePushPrefs(base, { 'lock-window-closing': false, other: false })).toEqual({
      ...DEFAULT_PUSH_PREFS,
      'lock-window-closing': false
    });
    expect(mergePushPrefs(base, null)).toEqual(base);
  });
});

describe('push client helpers', () => {
  it('decodes the VAPID application server key', () => {
    const bytes = urlBase64ToUint8Array(Buffer.from([4, 250, 251, 1]).toString('base64url'));
    expect(Array.from(bytes)).toEqual([4, 250, 251, 1]);
  });

  it('detects support states', () => {
    const ok = {
      hasServiceWorker: true,
      hasPushManager: true,
      hasNotification: true,
      permission: 'default',
      registered: true
    };
    expect(detectPushSupport(ok)).toBe('supported');
    expect(detectPushSupport({ ...ok, hasPushManager: false })).toBe('unsupported');
    expect(detectPushSupport({ ...ok, permission: 'denied' })).toBe('permission-denied');
    expect(detectPushSupport({ ...ok, registered: false })).toBe('no-service-worker');
  });
});
