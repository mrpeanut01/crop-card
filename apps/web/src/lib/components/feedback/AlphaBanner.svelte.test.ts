/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import AlphaBanner from './AlphaBanner.svelte';

beforeEach(() => localStorage.clear());

describe('AlphaBanner', () => {
  it('welcomes a first visitor and says feedback needs sign-in', async () => {
    render(AlphaBanner);
    await tick();
    const banner = screen.getByTestId('alpha-banner');
    expect(banner).toHaveTextContent('alpha review');
    expect(banner).toHaveTextContent('Send feedback in the account menu (top right).');
    expect(banner).not.toHaveTextContent('More');
    expect(screen.getByRole('link', { name: 'sign in' }).getAttribute('href')).toBe(
      '#signin-title'
    );
  });

  it('stays dismissed on this device', async () => {
    const first = render(AlphaBanner);
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss alpha notice' }));
    expect(screen.queryByTestId('alpha-banner')).toBeNull();
    first.unmount();
    render(AlphaBanner);
    await tick();
    expect(screen.queryByTestId('alpha-banner')).toBeNull();
  });
});
