/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';

const q = vi.hoisted(() => ({ enqueueRecord: vi.fn(async () => 'queued-1') }));
vi.mock('$lib/client/syncQueue', () => ({ enqueueRecord: q.enqueueRecord }));

import PhotoHelp from './PhotoHelp.svelte';
import CareGuideList from './CareGuideList.svelte';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { careGuideCardsFor, photoHelpTargets } from '$lib/journal/targets';
import type { JournalEntry } from '$lib/journal/model';

const snap = sampleSnapshot();
const tomato = photoHelpTargets(snap, 'pl_p_tom');
const garden = photoHelpTargets(snap, 'ar_f_garden');

let online = true;
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const ENTRY: JournalEntry = {
  id: 'j1',
  cropId: 'p_tom',
  blockId: 'b_bed3',
  createdAt: Date.UTC(2026, 5, 1),
  createdBy: 'u',
  kind: 'note',
  text: 'Staked the tomatoes',
  hasPhoto: false,
  answer: null,
  provenance: 'manual'
};

beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  fetchMock.mockReset();
  q.enqueueRecord.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PhotoHelp', () => {
  it('answers from the Care Guide offline and queues the question for later', async () => {
    online = false;
    const { getByRole, findByTestId, getByText } = render(PhotoHelp, {
      targets: tomato,
      role: 'helper'
    });
    await fireEvent.click(getByRole('button', { name: 'Is it ready to pick?' }));
    await fireEvent.click(getByRole('button', { name: 'Ask' }));
    const answer = await findByTestId('photo-answer');
    expect(answer.dataset.provenance).toBe('fallback');
    expect(answer.textContent).toContain('No signal right now');
    expect(answer.textContent).toContain('Harvest cues');
    expect(answer.textContent).toContain('Shoulders turn dusky purple');
    expect(answer.textContent).toContain('Will save when online');
    expect(q.enqueueRecord).toHaveBeenCalledWith(
      'journal',
      expect.objectContaining({ cropId: 'p_tom', kind: 'photo_help', text: 'Is it ready to pick?' })
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getByText(/The journal loads when you have signal/)).toBeTruthy();
  });

  it('treats a failed request as no signal', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/journal')) return jsonResponse({ entries: [] });
      throw new TypeError('Failed to fetch');
    });
    const { getByRole, getByLabelText, findByTestId } = render(PhotoHelp, {
      targets: tomato,
      role: 'owner'
    });
    await fireEvent.input(getByLabelText('Or ask in your own words'), {
      target: { value: 'Why are the leaves yellow?' }
    });
    await fireEvent.click(getByRole('button', { name: 'Ask' }));
    const answer = await findByTestId('photo-answer');
    expect(answer.textContent).toContain('Common problems');
    expect(q.enqueueRecord).toHaveBeenCalledWith(
      'journal',
      expect.objectContaining({ text: 'Why are the leaves yellow?' })
    );
  });

  it("shows Claude's answer tagged AI and adds it to the journal", async () => {
    const saved = { ...ENTRY, id: 'j2', kind: 'photo_help' as const, provenance: 'ai' as const };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/photo-help')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ question: 'prune', text: '' });
        return jsonResponse({
          provenance: 'ai',
          fallbackReason: null,
          message: null,
          answer: {
            question: 'prune',
            text: 'Pinch the small shoot in the crotch of each branch.',
            source: 'ai',
            sections: [],
            sprayRedirect: false
          },
          entry: saved
        });
      }
      return jsonResponse({ entries: [ENTRY] });
    });
    const { getByRole, findByTestId, findByText, getAllByRole } = render(PhotoHelp, {
      targets: tomato,
      role: 'owner'
    });
    await findByText('Staked the tomatoes');
    await fireEvent.click(getByRole('button', { name: 'Where do I prune?' }));
    await fireEvent.click(getByRole('button', { name: 'Ask' }));
    const answer = await findByTestId('photo-answer');
    expect(answer.dataset.provenance).toBe('ai');
    expect(answer.textContent).toContain('Pinch the small shoot');
    expect(answer.textContent).toContain('AI');
    await waitFor(() => expect(getAllByRole('button', { name: 'Delete' })).toHaveLength(2));
    expect(q.enqueueRecord).not.toHaveBeenCalled();
  });

  it('shows the Spray flow link when the answer points there', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/photo-help')) {
        return jsonResponse({
          provenance: 'fallback',
          fallbackReason: null,
          message: 'For anything you would spray, use the Spray flow and follow the product label.',
          answer: {
            question: 'other',
            text: '',
            source: 'fallback',
            sections: [{ title: 'Common problems', items: ['Remove the leaves.'] }],
            sprayRedirect: true
          }
        });
      }
      return jsonResponse({ entries: [] });
    });
    const { getByRole, getByLabelText, findByRole } = render(PhotoHelp, {
      targets: tomato,
      role: 'owner'
    });
    await fireEvent.input(getByLabelText('Or ask in your own words'), {
      target: { value: 'What do I spray?' }
    });
    await fireEvent.click(getByRole('button', { name: 'Ask' }));
    const link = await findByRole('link', { name: 'Open the Spray flow' });
    expect(link.getAttribute('href')).toBe('/spray');
  });

  it('is read-only for inspectors and hides delete from helpers', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ entries: [ENTRY] }));
    const inspector = render(PhotoHelp, { targets: tomato, role: 'inspector' });
    await inspector.findByText('Staked the tomatoes');
    expect(inspector.queryByRole('button', { name: 'Ask' })).toBeNull();
    expect(inspector.queryByLabelText('Add a note')).toBeNull();
    inspector.unmount();
    const helper = render(PhotoHelp, { targets: tomato, role: 'helper' });
    await helper.findByText('Staked the tomatoes');
    expect(helper.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(helper.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('saves a note offline to the queue', async () => {
    online = false;
    const { getByLabelText, getByRole, findByText } = render(PhotoHelp, {
      targets: tomato,
      role: 'helper'
    });
    await fireEvent.input(getByLabelText('Add a note'), { target: { value: 'Hail last night' } });
    await fireEvent.click(getByRole('button', { name: 'Save note' }));
    await findByText(/Saved on this phone/);
    expect(q.enqueueRecord).toHaveBeenCalledWith(
      'journal',
      expect.objectContaining({ kind: 'note', text: 'Hail last night', cropId: 'p_tom' })
    );
  });

  it('asks which planting on a garden Area card', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ entries: [] }));
    const { getByLabelText } = render(PhotoHelp, { targets: garden, role: 'owner' });
    const select = getByLabelText('Which planting?') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      garden.map((t) => t.label)
    );
    expect(garden.length).toBe(2);
  });

  it('renders nothing without a planting', () => {
    const { container } = render(PhotoHelp, { targets: [], role: 'owner' });
    expect(container.querySelector('[data-testid="photo-help"]')).toBeNull();
  });
});

describe('CareGuideList', () => {
  it('shows one guide open and several as disclosures', () => {
    const one = render(CareGuideList, { cards: careGuideCardsFor(snap, 'pl_p_tom') });
    expect(one.getByRole('heading', { name: 'How to care for it' })).toBeTruthy();
    expect(one.container.querySelectorAll('details')).toHaveLength(0);
    expect(one.container.textContent).toContain('Stake and prune');
    one.unmount();
    const many = render(CareGuideList, { cards: careGuideCardsFor(snap, 'ar_f_garden') });
    expect(many.container.querySelectorAll('details')).toHaveLength(2);
  });
});
