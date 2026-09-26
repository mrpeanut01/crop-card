/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import GettingStartedCard from './GettingStartedCard.svelte';
import type { GettingStartedFacts } from '$lib/onboarding/gettingStarted';

const FACTS: GettingStartedFacts = {
  profile: 'garden',
  hasLocation: true,
  hasMappedArea: false,
  hasPlanting: false,
  hasGardenBed: false,
  hasEquipment: false,
  hasSprayer: false,
  hasCalibratedSprayer: false,
  hasHelper: false,
  hasAiKey: false,
  hasPinnedCards: null
};

const DONE: GettingStartedFacts = {
  ...FACTS,
  hasMappedArea: true,
  hasPlanting: true,
  hasGardenBed: true
};

describe('GettingStartedCard', () => {
  it('lists the garden items with counts, links and optional tags', async () => {
    render(GettingStartedCard, {
      props: { facts: FACTS, dismissed: false, loadPinned: async () => false }
    });
    const card = screen.getByTestId('getting-started');
    expect(card).toHaveTextContent('Getting started · 1 of 6');
    expect(screen.getByRole('link', { name: /Set your farm location/ })).toHaveAttribute(
      'href',
      '/settings/farm'
    );
    expect(screen.getByRole('link', { name: /Design a garden bed/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add your equipment/ })).toBeNull();
    expect(screen.getByRole('link', { name: /planning assistant/ })).toHaveTextContent('Optional');
    expect(screen.getByRole('img', { name: '1 of 6 done' })).toBeInTheDocument();
  });

  it('ticks "Pin the cards you use most" once the device reports pinned cards', async () => {
    render(GettingStartedCard, {
      props: { facts: FACTS, dismissed: false, loadPinned: async () => true }
    });
    await waitFor(() =>
      expect(screen.getByTestId('getting-started')).toHaveTextContent('Getting started · 2 of 6')
    );
  });

  it('collapses to a slim strip once the required items are done, and expands on Show', async () => {
    render(GettingStartedCard, {
      props: { facts: DONE, dismissed: false, loadPinned: async () => true }
    });
    const strip = await screen.findByTestId('getting-started-strip');
    expect(strip).toHaveTextContent('Setup 5 of 6');
    await fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByTestId('getting-started')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: /A few things, when you're ready/ })
      )
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show' }))
    );
  });

  it('renders nothing when dismissed or fully done', async () => {
    const { container } = render(GettingStartedCard, {
      props: { facts: FACTS, dismissed: true, loadPinned: async () => false }
    });
    expect(container.querySelector('[data-testid^="getting-started"]')).toBeNull();
    const all = render(GettingStartedCard, {
      props: { facts: { ...DONE, hasAiKey: true }, dismissed: false, loadPinned: async () => true }
    });
    await waitFor(() =>
      expect(all.container.querySelector('[data-testid^="getting-started"]')).toBeNull()
    );
  });
});
