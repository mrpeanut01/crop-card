/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import BriefForm from './BriefForm.svelte';
import BriefShortlist from './BriefShortlist.svelte';
import type { ShortlistRow } from '$lib/garden/brief/schema';

const herbs = [
  { pluginId: 'basil-genovese', displayName: 'Basil — Genovese' },
  { pluginId: 'chives-common', displayName: 'Chives — Common' }
];

const rows: ShortlistRow[] = [
  {
    cropPluginId: 'chives-common',
    because: 'You asked for this one.',
    provenance: 'manual',
    reasons: [{ kind: 'wanted' }]
  },
  { cropPluginId: 'basil-genovese', because: 'Great with tomatoes.', provenance: 'ai' }
];

describe('BriefShortlist', () => {
  it('shows each herb with its reason, provenance and the lifecycle placeholder', () => {
    render(BriefShortlist, { rows, herbs });
    const items = screen.getAllByTestId('brief-row');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole('heading', { name: 'Chives — Common' })).toBeTruthy();
    expect(items[0].textContent).toContain('You asked for this one.');
    expect(items[1].textContent).toContain('Great with tomatoes.');
    expect(items[0].querySelector('[data-provenance="manual"]')).not.toBeNull();
    expect(items[1].querySelector('[data-provenance="ai"]')).not.toBeNull();
    for (const line of screen.getAllByTestId('lifecycle-line')) {
      expect(line.textContent).toContain('Annual or perennial here: not yet known');
      expect(line.querySelector('[data-provenance="fallback"]')).not.toBeNull();
    }
    expect(screen.queryByRole('button', { name: /Take .* off the list/ })).toBeNull();
  });

  it('shows each sun line and marks a herb that wants more sun than the spot (CO-5)', () => {
    render(BriefShortlist, {
      rows,
      herbs: [
        { pluginId: 'basil-genovese', displayName: 'Basil — Genovese', sunNeed: 'full' as const },
        { pluginId: 'chives-common', displayName: 'Chives — Common' }
      ],
      sun: 'half-day' as const
    });
    const lines = screen.getAllByTestId('sun-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('Wants full sun, more than this spot gets.');
    expect(lines[0].dataset.fit).toBe('mismatch');
    expect(lines[0].querySelector('[data-provenance="plugin"]')).not.toBeNull();
    expect(screen.getAllByTestId('brief-row')).toHaveLength(2);
  });

  it('shows the 37B verdict when the page has one', () => {
    render(BriefShortlist, {
      rows,
      herbs,
      lifecycle: { 'chives-common': { text: 'Comes back every year here', provenance: 'plugin' } }
    });
    expect(screen.getAllByTestId('lifecycle-line')[0].textContent).toContain(
      'Comes back every year here'
    );
  });

  it('shows the toxic-plant line only when pets live here', () => {
    const toxic = {
      'chives-common': {
        pluginId: 'chives-common',
        name: 'Chives — Common',
        toxicity: [
          {
            speciesIds: ['dog', 'cat'],
            parts: ['whole-plant' as const],
            severity: 'toxic' as const
          }
        ]
      }
    };
    const { unmount } = render(BriefShortlist, { rows, herbs, toxic, petSpecies: [] });
    expect(screen.queryByTestId('toxic-plants')).toBeNull();
    unmount();
    render(BriefShortlist, {
      rows,
      herbs,
      toxic,
      petSpecies: ['dog', 'cat'],
      speciesPlural: { dog: 'Dogs', cat: 'Cats' }
    });
    const line = screen.getByTestId('toxic-plants');
    expect(line.textContent).toContain('dogs and cats');
    expect(line.querySelector('[data-english-only="safety"]')).not.toBeNull();
  });

  it('lets the owner take a herb off the list', async () => {
    const onRemove = vi.fn();
    render(BriefShortlist, { rows, herbs, canEdit: true, onRemove });
    await fireEvent.click(
      screen.getByRole('button', { name: 'Take Basil — Genovese off the list' })
    );
    expect(onRemove).toHaveBeenCalledWith('basil-genovese');
  });
});

describe('BriefForm', () => {
  it('asks every question with an "I\'m not sure" option', () => {
    render(BriefForm, { answers: {}, herbs });
    for (const q of ['why', 'cuisines', 'wanted', 'avoid', 'time', 'sun', 'where', 'storage']) {
      const set = document.getElementById(`q-${q}`)!;
      expect(set, q).not.toBeNull();
      expect(within(set).getByLabelText("I'm not sure")).toBeTruthy();
    }
  });

  it('turns off a question\'s options once "I\'m not sure" is ticked', async () => {
    render(BriefForm, { answers: {}, herbs });
    const sun = document.getElementById('q-sun')!;
    const full = within(sun).getByLabelText('Full sun') as HTMLInputElement;
    expect(full.disabled).toBe(false);
    await fireEvent.click(within(sun).getByLabelText("I'm not sure"));
    expect(full.disabled).toBe(true);
  });

  it('finds an herb by name and adds it', async () => {
    render(BriefForm, { answers: {}, herbs });
    const wanted = document.getElementById('q-wanted')!;
    await fireEvent.input(within(wanted).getByLabelText('Find an herb'), {
      target: { value: 'bas' }
    });
    await fireEvent.click(within(wanted).getByRole('button', { name: 'Add Basil — Genovese' }));
    expect(within(wanted).getByRole('button', { name: 'Remove Basil — Genovese' })).toBeTruthy();
  });

  it('is read-only when disabled', () => {
    render(BriefForm, { answers: {}, herbs, disabled: true });
    expect((screen.getByLabelText('Cooking') as HTMLInputElement).disabled).toBe(true);
  });
});
