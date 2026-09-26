/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render, within } from '@testing-library/svelte';
import CardView from './CardView.svelte';
import CardPrintSheet from './CardPrintSheet.svelte';
import { buildAreaCard, buildPlantingCard, buildPlantingCards } from '$lib/cards/build';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { printLinkFor } from '$lib/cards/print';
import { STALE_NOTICE, type CardModel } from '$lib/cards/model';
import { sampleGearSnapshot } from '$lib/cards/build/fixturesGear';
import {
  SPRAY_RECHECK_NOTICE,
  SPRAY_REFERENCE_NOTICE,
  SPRAY_STALE_AFTER_MS,
  buildSprayCard
} from '$lib/cards/build/spray';

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
    expect(next).toHaveAttribute('href', '/plan?block=b_bed3#plan-scheduled-tasks');
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
      /You typed \(kind picked by you\)/
    );
    expect(container.querySelector('.qr')).toBeNull();
  });

  it('print: decon-first and bee cautions sit above the clipped content on a spray card', () => {
    const gear = sampleGearSnapshot();
    const product = gear.sprayProducts!['24d'];
    gear.sprayProducts!['24d'] = {
      ...product,
      pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'prohibited-during-bloom' }
    } as typeof product;
    const card = buildSprayCard(gear, 'eq_boom~24d')!;
    const { container } = render(CardView, { card, variant: 'print', prefs });
    const safety = [...container.querySelectorAll('[data-safety-section]')];
    const body = container.querySelector('.body')!;
    const content = container.querySelector('.content')!;
    expect(safety.map((s) => s.querySelector('h4')?.textContent)).toEqual([
      card.sections[0].title,
      'Before you spray'
    ]);
    expect(card.sections[0].title).toMatch(/^Decon first/);
    for (const s of safety) {
      expect(s.parentElement).toBe(body);
      expect(content.contains(s)).toBe(false);
    }
    expect(safety[1].textContent).toMatch(/bloom/);
    expect(container.querySelector('.notices')?.textContent).toMatch(/Decon first/);
    expect(container.querySelector('.more')?.textContent).toMatch(/label/);
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

describe('CardView spray cautions', () => {
  const spray = buildSprayCard(sampleGearSnapshot(), 'eq_boom~24d')!;

  it('shows both cautions on every variant and the rules version where there is a footer', () => {
    for (const variant of ['screen', 'compact', 'print'] as const) {
      const { getByText, unmount } = render(CardView, {
        card: spray,
        prefs,
        variant,
        now: spray.asOf
      });
      expect(getByText(SPRAY_RECHECK_NOTICE)).toBeInTheDocument();
      expect(getByText(SPRAY_REFERENCE_NOTICE)).toBeInTheDocument();
      expect(getByText('Rules ' + spray.rulesVersion)).toBeInTheDocument();
      unmount();
    }
  });

  it('adds the stale banner only after 24 hours', () => {
    const fresh = render(CardView, { card: spray, prefs, now: spray.asOf + SPRAY_STALE_AFTER_MS });
    expect(fresh.queryByText(STALE_NOTICE)).toBeNull();
    fresh.unmount();
    const stale = render(CardView, {
      card: spray,
      prefs,
      now: spray.asOf + SPRAY_STALE_AFTER_MS + 60_000
    });
    expect(stale.getByRole('status')).toHaveTextContent(STALE_NOTICE);
  });

  it('never marks a planting card stale', () => {
    const { queryByText } = render(CardView, { card: tomato, prefs, now: tomato.asOf + 9e10 });
    expect(queryByText(STALE_NOTICE)).toBeNull();
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

  it('task cards show their derived status as a pill on screen and as text in print', () => {
    const card: CardModel = {
      ...tomato,
      kind: 'task',
      key: 'tk_t1',
      status: { id: 'late', label: 'Late', tone: 'rust' }
    };
    for (const variant of ['screen', 'compact'] as const) {
      const { container, unmount } = render(CardView, { card, prefs, variant });
      const pill = container.querySelector('[data-card-status="late"]')!;
      expect(pill).toHaveTextContent('Late');
      expect(pill.querySelector('.pill')).not.toBeNull();
      unmount();
    }
    const { container } = render(CardView, { card, prefs, variant: 'print' });
    const text = container.querySelector('[data-card-status="late"]')!;
    expect(text).toHaveTextContent('Late');
    expect(text.querySelector('.pill')).toBeNull();
  });

  it('cards without a status keep the plain kicker', () => {
    const { container } = render(CardView, { card: tomato, prefs, variant: 'compact' });
    expect(container.querySelector('[data-card-status]')).toBeNull();
    expect(container.querySelector('.kicker-row')).toBeNull();
  });
});

describe('CardView on live pages (30G)', () => {
  const card: CardModel = {
    ...tomato,
    status: { label: 'active', tone: 'forest' },
    accent: '#7a8f5a'
  };

  it('shows a derived status pill on screen and plain text in print', () => {
    const screenView = render(CardView, { card, prefs });
    expect(screenView.container.querySelector('[data-card-status]')?.textContent?.trim()).toBe(
      'active'
    );
    screenView.unmount();
    const printView = render(CardView, { card, prefs, variant: 'print' });
    expect(printView.container.querySelector('.status-text')?.textContent).toBe('active');
    expect(printView.container.querySelector('[data-card-status]')).toBeNull();
  });

  it('uses the accent for the strip', () => {
    const { container } = render(CardView, { card, prefs });
    const article = container.querySelector('article') as HTMLElement;
    expect(article.style.getPropertyValue('--strip')).toBe('#7a8f5a');
  });

  it('selected marks the title link current', () => {
    const { getByRole, container } = render(CardView, {
      card,
      prefs,
      variant: 'compact',
      selected: true
    });
    expect(getByRole('link', { name: card.title })).toHaveAttribute('aria-current', 'true');
    expect(container.querySelector('article')?.classList.contains('selected')).toBe(true);
  });

  it('factLimit widens the compact variant and showAsOf drops the time', () => {
    const { container } = render(CardView, {
      card,
      prefs,
      variant: 'compact',
      factLimit: 4,
      showAsOf: false
    });
    expect(container.querySelectorAll('dt')).toHaveLength(Math.min(4, card.facts.length));
    expect(container.querySelector('.asof')).toBeNull();
  });

  it('print always keeps the as-of time', () => {
    const { container } = render(CardView, { card, prefs, variant: 'print', showAsOf: false });
    expect(container.querySelector('.asof')).not.toBeNull();
  });

  it('renders screen actions and leaves them off print', () => {
    const actions = createRawSnippet(() => ({
      render: () => '<button type="button">Jump</button>'
    }));
    const screenView = render(CardView, { card, prefs, actions });
    expect(screenView.getByRole('button', { name: 'Jump' })).toBeInTheDocument();
    screenView.unmount();
    const printView = render(CardView, { card, prefs, variant: 'print', actions });
    expect(printView.queryByRole('button', { name: 'Jump' })).toBeNull();
  });

  it('a scout card gets its own strip color class', () => {
    const scout: CardModel = { ...card, kind: 'scout', key: 'rc_scout.1', accent: undefined };
    const { container } = render(CardView, { card: scout, prefs });
    expect(container.querySelector('article')?.classList.contains('kind-scout')).toBe(true);
  });
});
