import { describe, expect, it } from 'vitest';
import { isAnonymous } from '../../src/hooks.server';

describe('offline Cards shell through the request boundary', () => {
  it('the data-free /cards shell is reachable without a session so the SW can precache it', () => {
    expect(isAnonymous('/cards')).toBe(true);
  });

  it('card data and every other /cards path still require a session', () => {
    expect(isAnonymous('/cards/__data.json')).toBe(false);
    expect(isAnonymous('/cards/planting/pl_1')).toBe(false);
    expect(isAnonymous('/cards/planting/pl_1/__data.json')).toBe(false);
    expect(isAnonymous('/api/cards/snapshot')).toBe(false);
    expect(isAnonymous('/c/pl_1')).toBe(false);
  });
});
