import type { CardKind, CardModel } from './model';

export type DeckFilter =
  | 'all'
  | 'pinned'
  | 'today'
  | 'animals'
  | Extract<CardKind, 'planting' | 'area' | 'equipment' | 'spray' | 'careGuide'>;

export const DECK_FILTERS: { id: DeckFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'today', label: 'Today' },
  { id: 'animals', label: 'Animals' },
  { id: 'planting', label: 'Plantings' },
  { id: 'area', label: 'Areas' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'spray', label: 'Spray' },
  { id: 'careGuide', label: 'Care guides' }
];

export function isDeckFilter(value: unknown): value is DeckFilter {
  return typeof value === 'string' && DECK_FILTERS.some((f) => f.id === value);
}

/** Pinned cards first (newest pin first), then deck order. */
export function orderDeck(cards: readonly CardModel[], pinned: readonly string[]): CardModel[] {
  const rank = new Map(pinned.map((key, i) => [key, i]));
  return cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => {
      const pa = rank.get(a.card.key);
      const pb = rank.get(b.card.key);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.i - b.i;
    })
    .map(({ card }) => card);
}

export function filterDeck(
  cards: readonly CardModel[],
  filter: DeckFilter,
  pinned: readonly string[]
): CardModel[] {
  const ordered = orderDeck(cards, pinned);
  if (filter === 'all') return ordered;
  if (filter === 'pinned') {
    const set = new Set(pinned);
    return ordered.filter((c) => set.has(c.key));
  }
  if (filter === 'today') return ordered.filter((c) => c.kind === 'day');
  if (filter === 'animals') {
    return ordered.filter((c) => c.kind === 'flock' || c.kind === 'animal');
  }
  if (filter === 'area') return ordered.filter((c) => c.kind === 'area' || c.kind === 'farmMap');
  return ordered.filter((c) => c.kind === filter);
}

export interface DeckSlot {
  card: CardModel;
  /** Member cards folded under a Flock Card (D2-14). */
  members: CardModel[];
}

/** Folds each card whose `parentKey` card is also shown under that card,
 *  in the order given. A member whose Flock Card is not shown (filtered
 *  out, or not pinned under the Pinned filter) stays a slot of its own. */
export function foldMembers(cards: readonly CardModel[]): DeckSlot[] {
  const shown = new Set(cards.map((c) => c.key));
  const slots: DeckSlot[] = [];
  const byKey = new Map<string, DeckSlot>();
  const pending: CardModel[] = [];
  for (const card of cards) {
    if (card.parentKey && shown.has(card.parentKey)) {
      pending.push(card);
      continue;
    }
    const slot = { card, members: [] };
    slots.push(slot);
    byKey.set(card.key, slot);
  }
  for (const card of pending) byKey.get(card.parentKey!)?.members.push(card);
  return slots;
}
