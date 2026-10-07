import { describe, it, expect, vi } from 'vitest';

const apiKey = vi.hoisted(() => ({ value: '' }));
const farm = vi.hoisted(() => ({ ownerId: null as string | null, cap: null as number | null }));
vi.mock('./scanResult', () => ({ getApiKey: () => apiKey.value }));
vi.mock('$lib/db/tenant', () => ({ currentOwnerId: () => farm.ownerId }));
vi.mock('$lib/schedule/settings', () => ({ getAiMonthlyUsdCapSetting: () => farm.cap }));

import { aiTry, getUserAiEnabled } from './aiTry';

describe('getUserAiEnabled', () => {
  it('is on for any signed-in user once a key is configured', () => {
    apiKey.value = 'sk-ant-test';
    expect(getUserAiEnabled('user_a')).toBe(true);
    expect(getUserAiEnabled('user_never_saved_the_key')).toBe(true);
  });

  it('is off with no key or no user', () => {
    apiKey.value = '';
    expect(getUserAiEnabled('user_a')).toBe(false);
    apiKey.value = 'sk-ant-test';
    expect(getUserAiEnabled(null)).toBe(false);
  });

  it('is off when the farm turned AI off, as every demo farm does (#611)', () => {
    apiKey.value = 'sk-ant-test';
    farm.ownerId = 'owner_a';
    farm.cap = 0;
    expect(getUserAiEnabled('user_a')).toBe(false);
    farm.cap = 4;
    expect(getUserAiEnabled('user_a')).toBe(true);
    farm.cap = null;
    expect(getUserAiEnabled('user_a')).toBe(true);
    farm.ownerId = null;
    farm.cap = 0;
    expect(getUserAiEnabled('user_a')).toBe(true);
    farm.cap = null;
  });
});

describe('aiTry', () => {
  it('runs fallback with no-key when aiEnabled is false', async () => {
    const prompt = vi.fn(async () => ({ value: 'ai-result' }));
    const fallback = vi.fn(async () => 'fallback-result');
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: false,
      prompt,
      fallback
    });
    expect(out).toEqual({
      value: 'fallback-result',
      provenance: 'fallback',
      fallbackReason: 'no-key'
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('runs fallback with over-cap when overCap flag set', async () => {
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: true,
      overCap: true,
      prompt: async () => ({ value: 'ai' }),
      fallback: async () => 'fb'
    });
    expect(out.provenance).toBe('fallback');
    expect(out.fallbackReason).toBe('over-cap');
  });

  it('runs fallback with rate-limit when rateLimited flag set', async () => {
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: true,
      rateLimited: true,
      prompt: async () => ({ value: 'ai' }),
      fallback: async () => 'fb'
    });
    expect(out.fallbackReason).toBe('rate-limit');
  });

  it('returns ai-tagged result + confidence on success', async () => {
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: true,
      prompt: async () => ({ value: 'ai-result', confidence: 0.92 }),
      fallback: async () => 'fb'
    });
    expect(out).toEqual({
      value: 'ai-result',
      provenance: 'ai',
      confidence: 0.92
    });
  });

  it('falls back with timeout when prompt exceeds timeoutMs', async () => {
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: true,
      timeoutMs: 20,
      prompt: () =>
        new Promise<{ value: string }>((resolve) => {
          setTimeout(() => resolve({ value: 'too-late' }), 100);
        }),
      fallback: async () => 'fb'
    });
    expect(out).toEqual({
      value: 'fb',
      provenance: 'fallback',
      fallbackReason: 'timeout'
    });
  });

  it('falls back with rate-limit when prompt throws', async () => {
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: true,
      prompt: async () => {
        throw new Error('429 too many requests');
      },
      fallback: async () => 'fb'
    });
    expect(out).toEqual({
      value: 'fb',
      provenance: 'fallback',
      fallbackReason: 'rate-limit'
    });
  });

  it('returns fallback value identically — caller treats both as the same shape', async () => {
    const valueShape = { dates: [1, 2, 3], note: 'ok' };
    const out = await aiTry({
      endpoint: 'test',
      aiEnabled: false,
      prompt: async () => ({ value: valueShape }),
      fallback: () => valueShape
    });
    expect(out.value).toBe(valueShape);
  });
});
