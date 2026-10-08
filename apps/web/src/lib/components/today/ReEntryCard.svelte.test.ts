/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import ReEntryCard from './ReEntryCard.svelte';

const NOW = Date.UTC(2026, 5, 1, 12);

describe('ReEntryCard', () => {
  it('renders each active REI with its clear time, and the unknown sentence for a partial tank', () => {
    render(ReEntryCard, {
      props: {
        items: [
          {
            recordKind: 'insecticide',
            recordId: 'i1',
            blockId: 'b1',
            blockName: 'North bed',
            products: ['Bug 72'],
            clearAt: NOW + 3600_000
          },
          {
            recordKind: 'spray',
            recordId: 's/1',
            blockId: 'gone',
            blockName: null,
            products: ['Herb Twelve', 'Herb Unknown'],
            clearAt: null
          }
        ]
      }
    });
    const card = screen.getByTestId('today-rei-card');
    expect(card).toHaveAttribute('role', 'alert');
    expect(within(card).getByRole('heading')).toHaveTextContent(
      'Stay out: re-entry interval in effect'
    );
    const [first, second] = screen.getAllByTestId('today-rei-item');
    expect(first).toHaveTextContent('North bed');
    expect(first).toHaveTextContent(/Bug 72: REI in effect until /);
    expect(within(first).getByRole('link', { name: 'Open the spray record' })).toHaveAttribute(
      'href',
      '/records/insecticide/i1'
    );
    expect(second).toHaveTextContent('Removed block');
    expect(second).toHaveTextContent(
      'Herb Twelve + Herb Unknown: REI not known for every product. Check the label.'
    );
    expect(second).not.toHaveTextContent('until');
    expect(within(second).getByRole('link')).toHaveAttribute('href', '/records/spray/s%2F1');
    const safety = second.querySelector('[data-english-only="safety"]');
    expect(safety).toHaveAttribute('lang', 'en');
    expect(card.querySelector('button')).toBeNull();
  });

  it('renders nothing when no REI is running', () => {
    render(ReEntryCard, { props: { items: [] } });
    expect(screen.queryByTestId('today-rei-card')).toBeNull();
  });
});
