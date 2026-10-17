/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import ObservedTemps from './ObservedTemps.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

const HOUR = 3_600_000;

afterEach(() => {
  page.data = {};
  vi.useRealTimers();
});

function reply(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response);
}

function yesterdayHours() {
  const now = Date.now();
  const start = now - 30 * HOUR;
  return Array.from({ length: 30 }, (_, i) => ({ t: start + i * HOUR, tempF: 40 + i }));
}

describe('ObservedTemps', () => {
  it('does not fetch until the sheet opens', () => {
    const fetcher = reply({});
    render(ObservedTemps, { open: false, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('shows highs and lows with the NOAA source once opened', async () => {
    const fetcher = reply({
      hours: yesterdayHours(),
      provenance: 'data',
      station: { label: 'Dulles (KIAD)' },
      location: { source: 'farm' }
    });
    render(ObservedTemps, { open: true, fetcher });
    await waitFor(() => expect(screen.getByText(/Measured at Dulles \(KIAD\)/)).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toMatch(
      /^\/api\/weather\/observed\?from=\d+$/
    );
    expect(screen.getAllByText(/^High /).length).toBeGreaterThan(0);
    expect(screen.getByText('NOAA')).toBeTruthy();
  });

  it('says not available with no station, a default location or a failed fetch', async () => {
    for (const body of [
      { hours: [], provenance: 'fallback', station: null },
      {
        hours: yesterdayHours(),
        provenance: 'data',
        station: { label: 'Dulles' },
        location: { source: 'farm-default' }
      }
    ]) {
      const { unmount } = render(ObservedTemps, { open: true, fetcher: reply(body) });
      await waitFor(() => expect(screen.getByTestId('observed-unavailable')).toBeTruthy());
      unmount();
    }
    render(ObservedTemps, { open: true, fetcher: reply({}, false) });
    await waitFor(() =>
      expect(screen.getByText('Past temperatures are not available for this farm.')).toBeTruthy()
    );
  });

  it('reads in Spanish', async () => {
    page.data = { locale: 'es' };
    render(ObservedTemps, { open: true, fetcher: reply({}, false) });
    expect(screen.getByText('Últimos 7 días')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByText('Las temperaturas pasadas no están disponibles para esta granja.')
      ).toBeTruthy()
    );
  });
});
