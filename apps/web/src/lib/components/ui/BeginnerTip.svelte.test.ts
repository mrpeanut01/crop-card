/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

const pageData = vi.hoisted(() => ({
  data: {
    locale: 'en',
    beginnerTips: true as boolean | undefined,
    seenTips: [] as string[],
    user: { id: 'u-tip', role: 'owner' }
  }
}));
vi.mock('$app/state', () => ({ page: pageData }));

import BeginnerTip from './BeginnerTip.svelte';
import Hint from './Hint.svelte';
import { claimHint, hintState, initHints, resetHintsForTest } from '$lib/client/hints';

let server: Set<string>;

beforeEach(() => {
  localStorage.clear();
  resetHintsForTest();
  pageData.data = {
    locale: 'en',
    beginnerTips: true,
    seenTips: [],
    user: { id: 'u-tip', role: 'owner' }
  };
  server = new Set();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        for (const k of (JSON.parse(String(init.body)) as { keys: string[] }).keys) server.add(k);
      }
      return new Response(JSON.stringify({ hints: [...server].map((key) => ({ key })) }), {
        status: 200
      });
    })
  );
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const tip = () => screen.queryByTestId('beginner-tip');

describe('BeginnerTip', () => {
  it('says what the page is for, links to the guide and the first step', () => {
    render(BeginnerTip, { props: { tip: 'today' } });
    expect(tip()).toHaveTextContent('New here?');
    expect(tip()).toHaveTextContent('Your jobs for today');
    expect(screen.getByRole('link', { name: 'How to start' })).toHaveAttribute('href', '/start');
    expect(screen.getByRole('link', { name: 'Plan what to grow' })).toHaveAttribute(
      'href',
      '/plan'
    );
  });

  it('gives a helper wording with no owner-only step', () => {
    pageData.data.user.role = 'helper';
    render(BeginnerTip, { props: { tip: 'today' } });
    expect(tip()).toHaveTextContent('on this farm');
    expect(screen.queryByRole('link', { name: 'Plan what to grow' })).toBeNull();
  });

  it('renders nothing when tips are off or were never asked for', () => {
    pageData.data.beginnerTips = false;
    render(BeginnerTip, { props: { tip: 'today' } });
    expect(tip()).toBeNull();
    document.body.innerHTML = '';
    pageData.data.beginnerTips = undefined;
    render(BeginnerTip, { props: { tip: 'plan' } });
    expect(tip()).toBeNull();
  });

  it('renders nothing for a tip the server says was dismissed', () => {
    pageData.data.seenTips = ['tip_today'];
    render(BeginnerTip, { props: { tip: 'today' } });
    expect(tip()).toBeNull();
  });

  it('Got it hides it for good and records the key', async () => {
    const view = render(BeginnerTip, { props: { tip: 'spray' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(tip()).toBeNull());
    await waitFor(() => expect(server.has('tip_spray')).toBe(true));
    view.unmount();
    resetHintsForTest();
    server.clear();
    render(BeginnerTip, { props: { tip: 'spray' } });
    await waitFor(() => expect(tip()).toBeNull());
  });

  it('hides while a safety stop is on screen and comes back after', async () => {
    render(BeginnerTip, { props: { tip: 'spray' } });
    expect(tip()).not.toBeNull();
    const stop = document.createElement('div');
    stop.setAttribute('data-safety-stop', '');
    document.body.appendChild(stop);
    await waitFor(() => expect(tip()).toBeNull());
    stop.remove();
    await waitFor(() => expect(tip()).not.toBeNull());
  });

  it('makes an anchored hint wait until the tip is dismissed', async () => {
    const b = document.createElement('button');
    b.setAttribute('data-hint-anchor', 'spray_first');
    b.getBoundingClientRect = () =>
      ({ top: 100, bottom: 148, left: 20, right: 140, width: 120, height: 48 }) as DOMRect;
    document.body.appendChild(b);
    render(BeginnerTip, { props: { tip: 'spray' } });
    render(Hint, {
      props: { key: 'spray_first', anchor: '[data-hint-anchor=spray_first]', text: 'Pick a block.' }
    });
    await initHints('u-tip');
    await waitFor(() => expect(get(hintState).ready).toBe(true));
    expect(get(hintState).tip).toBe('tip_spray');
    expect(claimHint('spray_first')).toBe(false);
    expect(screen.queryByText('Pick a block.')).toBeNull();

    await fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);
    await waitFor(() => expect(screen.getByText('Pick a block.')).toBeInTheDocument());
    expect(get(hintState).tip).toBeNull();
  });

  it('frees the slot when it leaves the page', () => {
    const view = render(BeginnerTip, { props: { tip: 'plan' } });
    expect(get(hintState).tip).toBe('tip_plan');
    view.unmount();
    expect(get(hintState).tip).toBeNull();
  });
});
