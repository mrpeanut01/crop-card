import { describe, expect, it } from 'vitest';
import { isAnonymous } from '../../src/hooks.server';

describe('Stripe billing paths through the request boundary', () => {
  it('the Stripe webhook is reachable without a session (signature is the auth)', () => {
    expect(isAnonymous('/api/billing/stripe-webhook')).toBe(true);
  });

  it('checkout + portal APIs still require a session', () => {
    expect(isAnonymous('/api/billing/checkout')).toBe(false);
    expect(isAnonymous('/api/billing/portal')).toBe(false);
    expect(isAnonymous('/api/billing/stripe-webhook/extra')).toBe(false);
  });
});
