/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupFarmClimate from './SetupFarmClimate.svelte';

vi.mock('$app/forms', () => ({
  deserialize: (text: string) => JSON.parse(text)
}));

afterEach(() => vi.unstubAllGlobals());

describe('SetupFarmClimate (#475, asked in place)', () => {
  it('saves location and looked-up frost dates through the farm settings action', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ type: 'success', status: 200, data: { ok: true } }))
    );
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const { container } = render(SetupFarmClimate, {
      props: { latLon: { lat: 39.137, lon: -77.714 }, onDone }
    });
    await waitFor(
      () =>
        expect(
          container.querySelector<HTMLInputElement>('input[type="hidden"][name="lastFrost"]')?.value
        ).toMatch(/^\d{2}-\d{2}$/),
      { timeout: 5000 }
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Save location and frost dates' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/settings/farm?/save');
    const body = init!.body as FormData;
    expect(body.get('lat')).toBe('39.137');
    expect(body.get('frostBasis')).toBe('lookup');
    expect(body.get('farmName')).toBeNull();
  });

  it('shows the error the action returns and stays open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ type: 'failure', status: 400, data: { error: 'Bad dates.' } })
          )
      )
    );
    const onDone = vi.fn();
    render(SetupFarmClimate, { props: { latLon: { lat: 39.137, lon: -77.714 }, onDone } });
    const save = screen.getByRole('button', { name: 'Save location and frost dates' });
    await waitFor(() => expect(save).not.toBeDisabled(), { timeout: 5000 });
    await fireEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad dates.');
    expect(onDone).not.toHaveBeenCalled();
  });
});
