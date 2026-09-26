import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIosSafari, requestPersistentStorage, shouldNudgeInstall } from './offlineStorage';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

describe('isIosSafari', () => {
  it('matches iPhone Safari and iPadOS Safari with touch only', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_UA, 5)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_UA, 0)).toBe(false);
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
  });
});

describe('shouldNudgeInstall', () => {
  it('nudges only iOS Safari that is not installed and not dismissed', () => {
    const base = { userAgent: IPHONE_SAFARI, standalone: false, dismissed: false };
    expect(shouldNudgeInstall(base)).toBe(true);
    expect(shouldNudgeInstall({ ...base, standalone: true })).toBe(false);
    expect(shouldNudgeInstall({ ...base, dismissed: true })).toBe(false);
    expect(shouldNudgeInstall({ ...base, userAgent: ANDROID_CHROME })).toBe(false);
  });
});

describe('requestPersistentStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks once and reports the answer', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('skips the prompt when storage is already persistent', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('is false without the Storage API or when it throws', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage()).toBe(false);
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        persist: async () => {
          throw new Error('nope');
        }
      }
    });
    expect(await requestPersistentStorage()).toBe(false);
  });
});
