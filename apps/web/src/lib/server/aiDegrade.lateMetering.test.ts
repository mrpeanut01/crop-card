import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordCall, ownerSeen } = vi.hoisted(() => ({
  recordCall: vi.fn(),
  ownerSeen: [] as (string | null)[]
}));

vi.mock('./scanResult', () => ({ getApiKey: () => 'sk-test' }));
vi.mock('./aiGuard', () => ({
  checkGuard: () => ({ ok: true, spend: {} }),
  reserveGuard: () => ({ ok: true, spend: {} }),
  recordCall
}));

import { currentOwnerId, runWithTenantAsync } from '$lib/db/tenant';
import { tryAiWithGuard, usageFromMeta } from './aiDegrade';

const META = {
  model: 'claude-test',
  inputTokens: 1200,
  cachedInputTokens: 300,
  outputTokens: 450,
  usdEstimate: 0.042
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  recordCall.mockReset();
  ownerSeen.length = 0;
  recordCall.mockImplementation(() => ownerSeen.push(currentOwnerId()));
});

describe('tryAiWithGuard — late metering after timeout', () => {
  it('records the real usage when a timed-out call settles later', async () => {
    const late = deferred<{ suggestions: string[]; meta: typeof META }>();
    let seenSignal: AbortSignal | null = null;

    const out = await runWithTenantAsync('owner_a', () =>
      tryAiWithGuard({
        endpoint: 'suggest',
        userId: 'u1',
        timeoutMs: 5,
        prompt: (signal) => {
          seenSignal = signal;
          return late.promise;
        }
      })
    );

    expect(out.provenance).toBe('fallback');
    expect(out.provenance === 'fallback' && out.fallbackReason).toBe('timeout');
    expect(seenSignal!.aborted).toBe(true);
    expect(recordCall).not.toHaveBeenCalled();

    late.resolve({ suggestions: [], meta: META });
    await flush();

    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        endpoint: 'suggest',
        model: 'claude-test',
        inputTokens: 1200,
        cachedInputTokens: 300,
        outputTokens: 450,
        usdEstimate: 0.042,
        success: false,
        provenance: 'fallback',
        fallbackReason: 'timeout'
      })
    );
    expect(ownerSeen).toEqual(['owner_a']);
  });

  it('writes the late row under the captured Owner even if settled from another context', async () => {
    const late = deferred<{ meta: typeof META }>();
    await runWithTenantAsync('owner_b', () =>
      tryAiWithGuard({ endpoint: 'inputs', userId: 'u2', timeoutMs: 5, prompt: () => late.promise })
    );
    await runWithTenantAsync('owner_other', async () => late.resolve({ meta: META }));
    await flush();
    expect(ownerSeen).toEqual(['owner_b']);
  });

  it('uses a custom usageOf extractor when supplied', async () => {
    const late = deferred<{ tokens: number }>();
    await runWithTenantAsync('owner_a', () =>
      tryAiWithGuard({
        endpoint: 'optimize',
        userId: 'u1',
        timeoutMs: 5,
        prompt: () => late.promise,
        usageOf: (v) => ({ ...META, inputTokens: v.tokens })
      })
    );
    late.resolve({ tokens: 9 });
    await flush();
    expect(recordCall.mock.calls[0][0].inputTokens).toBe(9);
  });

  it('writes nothing when the aborted call rejects', async () => {
    const late = deferred<{ meta: typeof META }>();
    await runWithTenantAsync('owner_a', () =>
      tryAiWithGuard({
        endpoint: 'suggest',
        userId: 'u1',
        timeoutMs: 5,
        prompt: () => late.promise
      })
    );
    late.reject(new Error('Request was aborted.'));
    await flush();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it('writes nothing for a late settle that consumed no tokens', async () => {
    const late = deferred<{ meta: typeof META }>();
    await runWithTenantAsync('owner_a', () =>
      tryAiWithGuard({
        endpoint: 'suggest',
        userId: 'u1',
        timeoutMs: 5,
        prompt: () => late.promise
      })
    );
    late.resolve({ meta: { ...META, inputTokens: 0, outputTokens: 0, usdEstimate: 0 } });
    await flush();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it('does not late-meter or abort a call that finished in time', async () => {
    let seenSignal: AbortSignal | null = null;
    const out = await runWithTenantAsync('owner_a', () =>
      tryAiWithGuard({
        endpoint: 'suggest',
        userId: 'u1',
        timeoutMs: 1000,
        prompt: async (signal) => {
          seenSignal = signal;
          return { meta: META };
        }
      })
    );
    await flush();
    expect(out.provenance).toBe('ai');
    expect(seenSignal!.aborted).toBe(false);
    expect(recordCall).not.toHaveBeenCalled();
  });
});

describe('usageFromMeta', () => {
  it('reads AiResultMeta off a module result', () => {
    expect(usageFromMeta({ meta: META })).toEqual(META);
  });

  it('returns null for values without usable meta', () => {
    expect(usageFromMeta(null)).toBeNull();
    expect(usageFromMeta({})).toBeNull();
    expect(usageFromMeta({ meta: { model: 'x' } })).toBeNull();
  });
});
