/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CertifierPackPanel from './CertifierPackPanel.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('CertifierPackPanel', () => {
  it('downloads the pack through a plain link, never into page memory', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(CertifierPackPanel, { from: '2026-01-01', to: '2026-12-31' });
    const link = screen.getByTestId('pack-download');
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('download')).toBe(false);
    expect(link.hasAttribute('data-sveltekit-reload')).toBe(true);
    expect(link.getAttribute('href')).toBe('/api/organic/pack.zip?from=2026-01-01&to=2026-12-31');
    await fireEvent.click(screen.getByLabelText('Include the linked files themselves'));
    expect(link.getAttribute('href')).toBe(
      '/api/organic/pack.zip?from=2026-01-01&to=2026-12-31&documents=1'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names a reversed window before any request', async () => {
    render(CertifierPackPanel, { from: '2026-05-01', to: '2026-01-01' });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByTestId('pack-download').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The end date is before the start date.'
    );
  });
});
