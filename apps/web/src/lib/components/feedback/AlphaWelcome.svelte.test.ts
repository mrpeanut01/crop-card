/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { resetHintsForTest } from '$lib/client/hints';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/today'), data: { user: { id: 'u-welcome' } } }
}));

import AlphaWelcome from './AlphaWelcome.svelte';

let posted: unknown[] = [];

beforeEach(() => {
  localStorage.clear();
  resetHintsForTest();
  posted = [];
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ hints: [] }), { status: 200 });
    })
  );
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function isOpen(): boolean {
  return document.querySelector('dialog[open] [data-testid="alpha-welcome"]') !== null;
}

describe('AlphaWelcome', () => {
  it('greets a first-time user once and records it as a seen hint', async () => {
    render(AlphaWelcome);
    await vi.waitFor(() => expect(isOpen()).toBe(true));
    expect(screen.getByText(/alpha review/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(isOpen()).toBe(false);
    expect(localStorage.getItem('cropcard.alpha-welcome.seen')).toBe('1');
    await vi.waitFor(() => expect(posted).toContainEqual({ keys: ['alpha_welcome'] }));
  });

  it('never opens over a safety stop or urgent banner', async () => {
    const stop = document.createElement('div');
    stop.setAttribute('role', 'alert');
    stop.textContent = 'Sprayer needs decon';
    document.body.appendChild(stop);
    render(AlphaWelcome);
    await new Promise((r) => setTimeout(r, 30));
    expect(isOpen()).toBe(false);
  });

  it('stays closed when the parent holds it back', async () => {
    render(AlphaWelcome, { suppressed: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(isOpen()).toBe(false);
  });

  it('stays closed once seen on this device', async () => {
    localStorage.setItem('cropcard.alpha-welcome.seen', '1');
    render(AlphaWelcome);
    await new Promise((r) => setTimeout(r, 30));
    expect(isOpen()).toBe(false);
  });
});
