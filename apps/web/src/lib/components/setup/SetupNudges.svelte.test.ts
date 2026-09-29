/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupNudges from './SetupNudges.svelte';
import type { SetupNudge } from '$lib/onboarding/pageSetup';

const nudges: SetupNudge[] = [
  { id: 'season', title: 'Season', body: 'Set it up.', href: '/settings/season', action: 'Set up' },
  { id: 'seed', title: 'Seed', body: 'Ask the owner to add it.', href: null, action: null }
];

afterEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('SetupNudges (#475)', () => {
  it('shows each nudge, with a link only where the viewer can act', () => {
    render(SetupNudges, { nudges, scope: 't1' });
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/settings/season'
    );
    expect(screen.getByText('Ask the owner to add it.')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('remembers Not now for the session', async () => {
    const first = render(SetupNudges, { nudges, scope: 't2' });
    await fireEvent.click(screen.getByRole('button', { name: 'Not now: Season' }));
    expect(screen.queryByText('Set it up.')).toBeNull();
    first.unmount();
    render(SetupNudges, { nudges, scope: 't2' });
    await waitFor(() => expect(screen.getByText('Ask the owner to add it.')).toBeInTheDocument());
    expect(screen.queryByText('Set it up.')).toBeNull();
  });

  it('hides while a safety stop is on screen', async () => {
    render(SetupNudges, { nudges, scope: 't3' });
    const stop = document.createElement('div');
    stop.setAttribute('data-safety-stop', '');
    document.body.appendChild(stop);
    await waitFor(() => expect(screen.queryByTestId('setup-nudges')).toBeNull());
  });

  it('answers a question in place when the page can ask it', async () => {
    const onAsk = vi.fn();
    render(SetupNudges, {
      nudges: [
        {
          id: 'location',
          title: 'Your farm location is not set',
          body: 'Set it.',
          href: '/settings/farm',
          action: 'Set farm location',
          ask: 'climate'
        }
      ],
      scope: 't4',
      onAsk
    });
    expect(screen.queryByRole('link', { name: 'Set farm location' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Set farm location' }));
    expect(onAsk).toHaveBeenCalledWith('climate');
  });

  it('keeps the count of waiting questions visible in the collapsed bar', () => {
    render(SetupNudges, { nudges, scope: 't5' });
    const summary = screen.getByTestId('setup-nudges').querySelector('summary')!;
    expect(summary.textContent).toMatch(/2 questions/);
    expect(getComputedStyle(summary.querySelector('.lead')!).whiteSpace).not.toBe('nowrap');
  });
});
