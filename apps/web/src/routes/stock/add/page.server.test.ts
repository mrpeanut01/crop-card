/**
 * #296 — legacy /stock/add must preserve the caller's `?category=` so a
 * seed link lands on /inventory/seed/add, not the old hardcoded pesticide
 * page. Unknown / missing category falls back to the type picker.
 */
import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

function redirectFrom(category?: string): { status: number; location: string } {
  const url = new URL(
    `http://localhost/stock/add${category ? `?category=${category}` : ''}`
  );
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (load as any)({ url });
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('expected a redirect to be thrown');
}

describe('/stock/add legacy redirect', () => {
  it('maps category=seed → /inventory/seed/add', () => {
    expect(redirectFrom('seed').location).toBe('/inventory/seed/add');
  });

  it('maps category=herbicide → /inventory/pesticide/add', () => {
    expect(redirectFrom('herbicide').location).toBe('/inventory/pesticide/add');
  });

  it('maps category=fertilizer → /inventory/fertility/add', () => {
    expect(redirectFrom('fertilizer').location).toBe('/inventory/fertility/add');
  });

  it('falls back to /inventory when no category is given', () => {
    expect(redirectFrom().location).toBe('/inventory');
  });

  it('falls back to /inventory for an unknown category', () => {
    expect(redirectFrom('widget').location).toBe('/inventory');
  });
});
