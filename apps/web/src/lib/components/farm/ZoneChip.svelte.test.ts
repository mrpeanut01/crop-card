/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/climate/zone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/climate/zone')>();
  return {
    ...actual,
    lookupZone: vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    })
  };
});

import ZoneChip from './ZoneChip.svelte';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ZoneChip', () => {
  it('says the lookup failed instead of looking it up forever', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as never;
    render(ZoneChip, { lat: 39.1, lon: -77.6, manualZone: null });
    expect(await screen.findByTestId('zone-failed', {}, { timeout: 2000 })).toHaveTextContent(
      'Could not look it up right now.'
    );
    expect(screen.queryByText('Looking it up…')).toBeNull();
  });
});
