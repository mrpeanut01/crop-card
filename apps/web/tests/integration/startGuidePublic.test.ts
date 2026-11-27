import { describe, expect, it } from 'vitest';
import { isAnonymous } from '../../src/hooks.server';

describe('the public "How to start" guide', () => {
  it('opens signed out, and nothing next to it does', () => {
    expect(isAnonymous('/start')).toBe(true);
    expect(isAnonymous('/start/extra')).toBe(false);
    expect(isAnonymous('/started')).toBe(false);
  });
});
