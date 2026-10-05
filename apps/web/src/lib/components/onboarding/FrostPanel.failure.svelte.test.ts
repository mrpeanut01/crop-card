/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import FrostPanel from './FrostPanel.svelte';

vi.mock('$lib/climate/frostNormals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/climate/frostNormals')>()),
  lookupFrostDates: vi.fn().mockRejectedValue(new Error('chunk failed to load'))
}));

describe('FrostPanel when the frost table cannot load', () => {
  it('falls back to the default dates instead of spinning forever', async () => {
    const { container } = render(FrostPanel, {
      props: { lat: 39.137, lon: -77.714, mode: 'auto' }
    });
    await waitFor(
      () =>
        expect(
          container.querySelector<HTMLInputElement>('input[type="hidden"][name="lastFrost"]')?.value
        ).toMatch(/^\d{2}-\d{2}$/),
      { timeout: 5000 }
    );
    expect(container.querySelector('[data-provenance="fallback"]')).not.toBeNull();
  });
});
