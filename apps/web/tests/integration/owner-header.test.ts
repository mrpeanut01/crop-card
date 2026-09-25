import { describe, expect, it } from 'vitest';
import { withOwnerHeader } from '../../src/hooks.server';
import { OWNER_HEADER } from '../../src/lib/client/swTenantKey';

describe('withOwnerHeader — SW cache ownership tag', () => {
  it('tags a mutable response in place', () => {
    const res = new Response('{}', { status: 200 });
    const out = withOwnerHeader(res, 'owner_a');
    expect(out.headers.get(OWNER_HEADER)).toBe('owner_a');
  });

  it('copies an immutable-header response and preserves status + body', async () => {
    const redirect = Response.redirect('https://x.test/today', 303);
    const out = withOwnerHeader(redirect, 'owner_b');
    expect(out.status).toBe(303);
    expect(out.headers.get(OWNER_HEADER)).toBe('owner_b');
    expect(out.headers.get('location')).toBe('https://x.test/today');
  });
});
