import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

function redirectFrom(search = ''): { status: number; location: string } {
  const url = new URL(`http://localhost/crops${search}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (load as any)({ url });
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('expected a redirect to be thrown');
}

describe('/crops legacy redirect (#178)', () => {
  it('308-redirects to /plan', () => {
    expect(redirectFrom()).toMatchObject({ status: 308, location: '/plan' });
  });

  it('maps ?blockId= onto the Plan v2 ?block= selector', () => {
    expect(redirectFrom('?blockId=b-1&status=harvested').location).toBe('/plan?block=b-1');
  });

  it('drops filters Plan v2 has no equivalent for', () => {
    expect(redirectFrom('?status=archived&year=2025').location).toBe('/plan');
  });
});
