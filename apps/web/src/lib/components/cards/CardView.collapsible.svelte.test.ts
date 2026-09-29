/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import CardView from './CardView.svelte';
import type { CardModel } from '$lib/cards/model';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const card: CardModel = {
  kind: 'area',
  key: 'ar_fold',
  kicker: 'Area',
  title: 'Goat lot',
  facts: [],
  sections: [
    {
      title: '1 plant here can harm goats',
      items: ['Sorghum: Leaves. Can harm goats.'],
      provenance: 'plugin',
      safety: true,
      collapsible: true
    }
  ],
  asOf: Date.UTC(2026, 8, 1),
  provenance: [{ source: 'plugin' }],
  href: '/plan'
};

describe('CardView collapsible section', () => {
  it('is a closed details element on screen', () => {
    const { container } = render(CardView, { card, prefs });
    const d = container.querySelector('details[data-collapsible-section]') as HTMLDetailsElement;
    expect(d).not.toBeNull();
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')?.textContent).toContain('1 plant here can harm goats');
  });

  it('prints every item, never folded', () => {
    const { container } = render(CardView, { card, prefs, variant: 'print' });
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('Sorghum: Leaves. Can harm goats.');
  });
});
