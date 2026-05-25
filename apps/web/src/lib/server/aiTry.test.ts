import { describe, it, expect, vi } from 'vitest';
import { aiTry } from './aiTry';

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
