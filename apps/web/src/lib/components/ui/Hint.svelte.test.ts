/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import hintSource from './Hint.svelte?raw';
import { readFileSync } from 'node:fs';

vi.mock('$app/state', () => ({ page: { data: { user: { id: 'u-hint' } } } }));

import Hint from './Hint.svelte';
import { resetHintsForTest } from '$lib/client/hints';

let server: Set<string>;

function installFetch() {
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
}

function addAnchor(id: string) {
  const b = document.createElement('button');
  b.textContent = 'Add planting';
  b.setAttribute('data-hint-anchor', id);
  b.getBoundingClientRect = () =>
    ({ top: 100, bottom: 148, left: 20, right: 140, width: 120, height: 48 }) as DOMRect;
  document.body.appendChild(b);
  return b;
}

beforeEach(() => {
  localStorage.clear();
  resetHintsForTest();
  installFetch();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Hint', () => {
  it('points at its anchor and hides for good after Got it', async () => {
    addAnchor('plan_first_crop');
    render(Hint, {
      props: {
        key: 'plan_first_crop',
        anchor: '[data-hint-anchor=plan_first_crop]',
        text: 'Start here.'
      }
    });
    const note = await screen.findByRole('note', { name: 'Tip' });
    expect(note).toHaveTextContent('Start here.');
    await fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
    await waitFor(() => expect(server.has('plan_first_crop')).toBe(true));
  });

  it('stays hidden when the server says it was already seen', async () => {
    server.add('map_add');
    addAnchor('map_add');
    render(Hint, {
      props: { key: 'map_add', anchor: '[data-hint-anchor=map_add]', text: 'Tap Add.' }
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows only one hint at a time', async () => {
    addAnchor('map_add');
    addAnchor('map_filter');
    render(Hint, {
      props: { key: 'map_add', anchor: '[data-hint-anchor=map_add]', text: 'First.' }
    });
    render(Hint, {
      props: { key: 'map_filter', anchor: '[data-hint-anchor=map_filter]', text: 'Second.' }
    });
    await screen.findByRole('note');
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });

  it('never shows over a safety STOP', async () => {
    addAnchor('spray_first');
    const stop = document.createElement('div');
    stop.setAttribute('data-safety-stop', '');
    document.body.appendChild(stop);
    render(Hint, {
      props: { key: 'spray_first', anchor: '[data-hint-anchor=spray_first]', text: 'Hi.' }
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('renders nothing without its anchor', async () => {
    render(Hint, { props: { key: 'map_add', anchor: '[data-hint-anchor=nowhere]', text: 'Hi.' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('stays hidden while a draw mode is active elsewhere on the page', async () => {
    addAnchor('map_filter');
    const busy = document.createElement('p');
    busy.setAttribute('data-hint-busy', '');
    document.body.appendChild(busy);
    render(Hint, {
      props: { key: 'map_filter', anchor: '[data-hint-anchor=map_filter]', text: 'Filter.' }
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('Hint styling', () => {
  const src = hintSource;
  const tokens = readFileSync('src/lib/styles/tokens.css', 'utf8');
  const style = src.slice(src.indexOf('<style>'));
  const rule = (selector: string) => {
    const at = style.indexOf(`\n  ${selector} {`);
    return at < 0 ? '' : style.slice(at, style.indexOf('}', at));
  };
  const tokenHex = (decl: string | undefined) => {
    const name = decl?.match(/var\((--[\w-]+)\)/)?.[1];
    return name ? (tokens.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? '') : '';
  };
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const s = parseInt(h.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('sets its own body text color so the global p color cannot win', () => {
    const fg = tokenHex(rule('p').match(/\n\s*color:\s*([^;]+);/)?.[1]);
    const bg = tokenHex(rule('.hint').match(/background:\s*([^;]+);/)?.[1]);
    expect(fg).toMatch(/^#/);
    expect(bg).toMatch(/^#/);
    const [a, b] = [lum(fg), lum(bg)];
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws above Leaflet map controls', () => {
    expect(Number(rule('.hint').match(/z-index:\s*(\d+)/)?.[1])).toBeGreaterThan(1000);
  });
});
