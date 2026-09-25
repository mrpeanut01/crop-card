/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import UpdateToast from './UpdateToast.svelte';

describe('UpdateToast', () => {
  it('keeps a polite live region mounted but empty while hidden', () => {
    render(UpdateToast, { visible: false, onReload: vi.fn(), onDismiss: vi.fn() });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('announces the new version and reloads only on click', async () => {
    const onReload = vi.fn();
    render(UpdateToast, { visible: true, onReload, onDismiss: vi.fn() });
    expect(screen.getByRole('status')).toHaveTextContent('New version available');
    expect(onReload).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('Later dismisses without reloading', async () => {
    const onReload = vi.fn();
    const onDismiss = vi.fn();
    render(UpdateToast, { visible: true, onReload, onDismiss });
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });
});
