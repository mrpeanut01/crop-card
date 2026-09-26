/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/svelte';
import CardView from './CardView.svelte';
import CardPrintSheet from './CardPrintSheet.svelte';
import { buildAreaCard, buildPlantingCard, buildPlantingCards } from '$lib/cards/build';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { printLinkFor } from '$lib/cards/print';
import type { CardModel } from '$lib/cards/model';

const snap = sampleSnapshot();
const tomato = buildPlantingCard(snap, 'p_tom')!;
const prefs = { timeZone: 'America/New_York', units: 'us' as const };

describe('CardView', () => {
  it('renders an active, dated planting recorded by quantity in every variant', () => {
    const s = sampleSnapshot();
    s.plantings[0] = { ...s.plantings[0], plantCount: null, quantityPlanted: 12 };
    const card = buildPlantingCard(s, 'p_tom')!;
    for (const variant of ['screen', 'compact', 'print'] as const) {
      const { container, unmount } = render(CardView, { card, prefs, variant });
      expect(container.querySelector('article')).not.toBeNull();
      unmount();
    }
  });

  it('screen: kicker, serif title link, facts, next action and provenance footer', () => {
    const { container, getByRole, getByText } = render(CardView, { card: tomato, prefs });
    const article = container.querySelector('article')!;
    expect(article.dataset.cardKind).toBe('planting');
    expect(article.dataset.variant).toBe('screen');
    expect(getByText('Planting · Bed 3 · Kitchen Garden')).toBeInTheDocument();
    const heading = getByRole('heading', { name: 'Cherokee Purple tomato' });
    expect(heading.className).toMatch(/serif/);
    expect(within(heading).getByRole('link')).toHaveAttribute('href', '/cards/planting/pl_p_tom');
    expect(getByRole('article', { name: 'Cherokee Purple tomato' })).toBe(article);

    const terms = [...container.querySelectorAll('dt')].map((d) => d.textContent);
    expect(terms).toEqual(tomato.facts.map((f) => f.label));
    expect(getByText('18–24 in')).toBeInTheDocument();
    expect(getByText('48 in')).toBeInTheDocument();

    const next = getByRole('link', { name: /Next: Side-dress \(overdue since May 30\)/ });
    expect(next).toHaveAttribute('href', '/today?task=t_side');
    expect(next.className).toMatch(/next/);

    expect(getByText(/As of Jun 1, 2026, 9:00 AM/)).toBeInTheDocument();
    const footer = container.querySelector('footer')!;
    const sources = [...footer.querySelectorAll('[data-provenance]')].map(
      (e) => (e as HTMLElement).dataset.provenance
    );
    expect(sources).toEqual(tomato.provenance.map((p) => p.source));
    expect(container.querySelectorAll('dd [data-provenance]').length).toBe(
      tomato.facts.filter((f) => f.provenance).length
    );
    expect(getByText('Harvest cues')).toBeInTheDocument();
    expect(container.querySelector('.qr')).toBeNull();
  });

  it('formats the as-of time in the user zone', () => {
    const { getByText } = render(CardView, {
      card: tomato,
      prefs: { timeZone: 'Asia/Tokyo', units: 'us' }
    });
    expect(getByText(/As of Jun 1, 2026, 10:00 PM/)).toBeInTheDocument();
  });

  it('compact: two facts, no sections, no per-fact badges, still one next action', () => {
    const { container, getByRole, queryByText } = render(CardView, {
      card: tomato,
      variant: 'compact',
      prefs
    });
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(queryByText('Harvest cues')).toBeNull();
    expect(container.querySelector('[data-provenance]')).toBeNull();
    expect(getByRole('link', { name: /Next: Side-dress/ })).toBeInTheDocument();
  });

  it('print: kind label, no links, sections kept, provenance as text', () => {
    const area = buildAreaCard(snap, 'f_garden')!;
    const { container, queryAllByRole, getByText } = render(CardView, {
      card: area,
      variant: 'print',
      prefs
    });
    expect(getByText('Area')).toBeInTheDocument();
    expect(queryAllByRole('link')).toHaveLength(0);
    expect(getByText('Next:')).toBeInTheDocument();
    expect(getByText('Beds')).toBeInTheDocument();
    expect(container.querySelector('.prov-text')?.textContent).toMatch(
      /manual \(kind picked by you\)/
    );
    expect(container.querySelector('.qr')).toBeNull();
  });

  it('print: skips the kind label when the kicker already names the kind', () => {
    const { container } = render(CardView, { card: tomato, variant: 'print', prefs });
    expect(container.querySelector('.kind-label')).toBeNull();
  });

  it('print: renders the QR and the short URL beside it when a link is given', () => {
    const link = printLinkFor('https://app.cropcard.io', tomato.key)!;
    const { container, getByText } = render(CardView, {
      card: tomato,
      variant: 'print',
      prefs,
      printLink: link
    });
    const svg = container.querySelector('svg.qr')!;
    expect(svg.getAttribute('aria-label')).toBe(
      'QR code linking to https://app.cropcard.io/c/pl_p_tom'
    );
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(link.qr.d);
    expect(getByText('https://app.cropcard.io/c/pl_p_tom')).toBeInTheDocument();
  });

  it('ignores a print link outside the print variant', () => {
    const link = printLinkFor('https://app.cropcard.io', tomato.key)!;
    const { container } = render(CardView, { card: tomato, prefs, printLink: link });
    expect(container.querySelector('.qr')).toBeNull();
  });

  it('shows the rules version when the card carries one', () => {
    const card: CardModel = { ...tomato, rulesVersion: '0.5.6-issue130' };
    const { getByText } = render(CardView, { card, prefs });
    expect(getByText('Rules 0.5.6-issue130')).toBeInTheDocument();
  });

  it('renders a card with no facts, sections or next action', () => {
    const bare: CardModel = { ...tomato, facts: [], sections: [], next: undefined, provenance: [] };
    const { container } = render(CardView, { card: bare, prefs });
    expect(container.querySelector('dl')).toBeNull();
    expect(container.querySelector('.next')).toBeNull();
  });
});

describe('CardPrintSheet', () => {
  const cards = [
    ...buildPlantingCards(snap),
    buildAreaCard(snap, 'f_garden')!,
    buildAreaCard(snap, 'f_hay')!
  ];

  it('letter 4-up puts four cards on a page', () => {
    const { container } = render(CardPrintSheet, {
      cards,
      prefs,
      origin: 'https://app.cropcard.io'
    });
    const sheet = container.querySelector('.card-print-sheet')!;
    expect(sheet.getAttribute('data-layout')).toBe('letter-4up');
    const pages = sheet.querySelectorAll('.sheet-page');
    expect(pages).toHaveLength(2);
    expect(pages[0].querySelectorAll('.print-cell')).toHaveLength(4);
    expect(pages[1].querySelectorAll('.print-cell')).toHaveLength(1);
    expect(sheet.querySelectorAll('[data-variant="print"]')).toHaveLength(5);
    expect(sheet.querySelectorAll('svg.qr')).toHaveLength(5);
  });

  it('index-card layouts put one card on each page', () => {
    for (const layout of ['index-3x5', 'index-4x6'] as const) {
      const { container, unmount } = render(CardPrintSheet, { cards, prefs, layout });
      expect(container.querySelectorAll('.sheet-page')).toHaveLength(5);
      expect(container.querySelector(`.layout-${layout}`)).not.toBeNull();
      unmount();
    }
  });

  it('leaves the QR off without a stable origin', () => {
    const { container } = render(CardPrintSheet, { cards, prefs, origin: null });
    expect(container.querySelectorAll('svg.qr')).toHaveLength(0);
    expect(container.querySelectorAll('.short-url')).toHaveLength(0);
  });

  it('is hidden on screen unless previewing', () => {
    const hidden = render(CardPrintSheet, { cards, prefs });
    expect(hidden.container.querySelector('.card-print-sheet')?.classList.contains('preview')).toBe(
      false
    );
    hidden.unmount();
    const shown = render(CardPrintSheet, { cards, prefs, preview: true });
    expect(shown.container.querySelector('.card-print-sheet')?.classList.contains('preview')).toBe(
      true
    );
  });
});

describe('garden Area card', () => {
  const garden = buildAreaCard(snap, 'f_garden')!;

  it('screen: bed map thumbnail and an Open designer link', () => {
    const { getByTestId, getByRole } = render(CardView, { card: garden, prefs });
    const map = getByTestId('card-bed-map');
    expect(within(map).getByRole('img').getAttribute('aria-label')).toMatch(
      /^Bed map, 30 by 40 feet\..*Bed 3: Cherokee Purple tomato/
    );
    expect(getByRole('link', { name: 'Open designer' })).toHaveAttribute(
      'href',
      '/plan/areas/f_garden/design'
    );
  });

  it('print: bed map with a legend and no designer link', () => {
    const { getByTestId, queryByRole } = render(CardView, {
      card: garden,
      prefs,
      variant: 'print'
    });
    expect(getByTestId('card-bed-map')).toHaveTextContent('Bed 3: Cherokee Purple tomato');
    expect(queryByRole('link', { name: 'Open designer' })).toBeNull();
  });

  it('compact: no bed map', () => {
    const { queryByTestId } = render(CardView, { card: garden, prefs, variant: 'compact' });
    expect(queryByTestId('card-bed-map')).toBeNull();
  });
});
