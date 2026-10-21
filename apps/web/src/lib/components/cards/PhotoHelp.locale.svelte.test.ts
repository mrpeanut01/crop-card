/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const state = vi.hoisted(() => ({ locale: 'es' as string }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return { locale: state.locale };
    }
  }
}));
vi.mock('$lib/client/syncQueue', () => ({
  enqueueRecord: vi.fn(),
  listPendingForActiveOwner: vi.fn(async () => [])
}));

import PhotoHelp from './PhotoHelp.svelte';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { photoHelpTargets } from '$lib/journal/targets';
import type { JournalEntry } from '$lib/journal/model';

const tomato = photoHelpTargets(sampleSnapshot(), 'pl_p_tom');

function entry(id: string, kind: JournalEntry['kind'], text: string): JournalEntry {
  return {
    id,
    cropId: 'p_tom',
    blockId: 'b_bed3',
    createdAt: Date.UTC(2026, 5, 1),
    createdBy: 'u',
    kind,
    text,
    hasPhoto: false,
    answer: null,
    provenance: 'fallback'
  };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entries: [
              entry('j1', 'photo_help', 'Where do I prune?'),
              entry('j2', 'photo_help', 'Is it ready to pick? The tips look dry'),
              entry('j3', 'note', 'Where do I prune?')
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PhotoHelp in Spanish', () => {
  it('shows a stored preset question in Spanish and leaves notes as typed', async () => {
    const view = render(PhotoHelp, { targets: tomato, role: 'owner' });
    const list = await view.findByTestId('journal-entries');
    const text = list.textContent ?? '';
    expect(text).toContain('¿Dónde la podo?');
    expect(text).toContain('¿Ya está lista para cosechar? The tips look dry');
    expect(text.match(/Where do I prune\?/g)).toHaveLength(1);
  });
});
